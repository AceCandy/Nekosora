# Prompt Caching Guidelines

> Nekusora prompt 缓存策略契约。权威实现：`src/lib/stream.ts`（streamWithRoute）、`src/lib/providers/registry.ts`（buildLanguageModelWithKey）。

---

## 命中缓存的三个前提(与 agent 无关)

1. **上游原生支持缓存**:OpenAI/Anthropic/DeepSeek 官方端点支持;多数第三方中转不支持或剥掉 `cached_tokens`。换上游是根因解,代码无法弥补不支持缓存的上游。
2. **前缀稳定**:OpenAI 要求前 1024 token 完全一致;system/tools/早期历史必须跨轮固定,动态内容放末尾。
3. **够长**:OpenAI ≥1024 token;Anthropic 1024/2048;Gemini 32K。

> 代码层读取 `cached_tokens` 是对的:`@ai-sdk/openai` 与 `@ai-sdk/openai-compatible` 都解析 `prompt_tokens_details.cached_tokens` → `inputTokenDetails.cacheReadTokens`,`stream.ts` 读它落库。命中与否取决于上游 + 前缀,不是读取代码。

---

## AI SDK 能力边界(决定能复刻多少)

| 机制 | 支持 | 用法 |
|---|---|---|
| anthropic `cache_control` | ✅ | message/system 的 `providerOptions.anthropic.cacheControl={type:'ephemeral'}`(max 4 断点) |
| openai `promptCacheKey` | ✅ | `providerOptions.openai.promptCacheKey` → `prompt_cache_key` |
| openai-compatible 动态 headers | ✅ | `createOpenAICompatible({ headers })`(provider 每请求新建,可静态合并) |
| openai-compatible anthropic 风格 cache_control | ❌ | AI SDK 不暴露(pi 的 `cacheControlFormat:'anthropic'` 做不到) |
| openai `prompt_cache_retention:24h` | ❌ | AI SDK 不支持 |

---

## 实现:按 protocol 注入(复刻 pi 兜底)

### cacheKey 链路
`StreamChatOptions.cacheKey` —— 会话级稳定标识:
- **chat**(`/api/chat`):`conversationId`(强会话)。
- **网关**(`/v1/chat/completions`):`ctx.apiKeyId`(同 key 聚合,serverless 亲和)。
- **副任务**(title/memory/compact):**不传** → 不注入(prompt 短,缓存无意义)。
- 缺省(undefined):全链路不注入,回退现状。

### streamWithRoute 按 protocol 分支
- **anthropic**:system + 末条消息打 `cache_control` 断点(上游靠显式断点缓存)。
- **openai**:`providerOptions.openai.promptCacheKey = cacheKey`。
- **openai-compatible**:不在此处处理,靠 registry 注入的 session header。

### registry.ts(openai-compatible session header)
`buildLanguageModelWithKey(route, apiKey, cacheKey?)`:cacheKey 存在时,headers 合并 `session_id`/`x-client-request-id`/`x-session-affinity`(复刻 pi `sendSessionAffinityHeaders`,让 Fireworks 等 serverless 路由同 replica)。provider 实例每请求新建,故静态合并。

---

## Common Mistakes

- **给不支持缓存的中转打 cache_control / session header** → 无效(上游忽略或剥掉);根因解是换上游。
- **副任务传 cacheKey** → prompt 太短(<1024),缓存无意义,反而多一次 cache write 计费。
- **system 含每轮变化内容(时间戳等)** → 前缀每轮变,anthropic/openai 缓存全 miss。
- **以为换 SDK 能命中更多** → AI SDK 边界固定(openai-compatible anthropic 风格 cache_control 做不到),pi 能命中是连官方上游 + 前缀稳,不是 SDK 魔法。
