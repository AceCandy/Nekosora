# Design — 按协议注入 prompt 缓存控制(复刻 pi 策略)

## 背景

诊断确认:上游本身支持缓存(pi 用同一上游能命中),根因是我们用 AI SDK 默认没发缓存控制。pi 的机制 = `sessionId`+`cacheRetention` 触发,按 API 协议发不同字段。本任务按 protocol 分支复刻,用 conversationId/runId 当 cache key。

## 上游配置(已查 DB)

| 上游 | protocol | 缓存机制 |
|---|---|---|
| 火山(ark coding) | anthropic | 需显式 `cache_control` 断点 |
| ZEN-AI/硅基/阶跃/小米 | openai-compatible | session affinity header / 前缀自动 |

## AI SDK 能力边界(已查 .d.ts/源码)

| 机制 | 支持 | 用法 |
|---|---|---|
| anthropic cache_control | ✅ | message/system `providerOptions.anthropic.cacheControl={type:'ephemeral'}`(源码 1217) |
| openai promptCacheKey | ✅ | `providerOptions.openai.promptCacheKey` → `prompt_cache_key`(源码 895) |
| openai-compatible 动态 headers | ✅ | `createOpenAICompatible({ headers: ()=>({..}) })` |
| openai-compatible anthropic 风格 cache_control | ❌ | AI SDK 不暴露(openai-compatible 无 cacheControl) |
| openai prompt_cache_retention:24h | ❌ | AI SDK 不支持 |

## 方案

### 1. cache key 传递链路
- `StreamChatOptions` 加 `cacheKey?: string`。
- chat(`/api/chat`):传 `conversationId`。
- 网关(`/v1/chat/completions`):传 `runId`(或固定 key)。
- 副任务(title/memory/compact):prompt 短,不传(缓存意义小)。

### 2. registry.ts — openai-compatible session header
`buildLanguageModelWithKey(route, apiKey, cacheKey?)`:
- openai-compatible 分支:`headers: () => ({ ...commonHeaders, ...(cacheKey ? { 'session_id': cacheKey, 'x-client-request-id': cacheKey, 'x-session-affinity': cacheKey } : {}) })`。
- 仅在 cacheKey 存在时注入(Fireworks 等 serverless 靠它路由到同 replica)。

### 3. stream.ts streamWithRoute — 按 protocol 注入
- **anthropic**:在 system 与最后一条 user 消息上打 `providerOptions.anthropic.cacheControl={type:'ephemeral'}`。
  - ⚠️ 待验证:streamText 的 `system`/`instructions` 参数如何挂 providerOptions(AI SDK v5)。实施 Step 1 先确认。
- **openai**:`streamText({ providerOptions: { openai: { promptCacheKey: cacheKey } } })`。
- openai-compatible:缓存靠 registry 注入的 session header + 前缀稳定,streamText 不额外处理。

### 4. 前缀稳定性(辅助)
- 检查 system prompt 拼装(指令卡/知识库)是否每轮变化;时间戳等动态内容不放 system 前部。
- 本期仅检查+记录,不大改拼装逻辑。

## 待验证(实施时确认)
1. streamText system cacheControl 的 AI SDK v5 确切传法。
2. 火山 ark coding 端点接受 cache_control(anthropic 协议,应接受)。
3. 硅基/小米/ZEN 是否认 session affinity header(Fireworks 认,其余不确定;不认则该上游靠前缀)。

## 风险
- openai-compatible 的 anthropic 风格 cache_control 兜不到(若某上游正靠它,命中率不稳)。
- session header 对非 Fireworks 上游可能无效(无害,上游忽略即可)。
- anthropic cache_control 会增加 cache write 计费(首次),但后续命中省钱。

## 回滚
- cacheKey 链路全可选(undefined 时不注入,回退现状)。
- 按 protocol 分支独立,可单独回退。
