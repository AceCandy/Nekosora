# 按协议注入 prompt 缓存控制(复刻 pi 策略)

## Goal

按 protocol 分支注入缓存控制,用 conversationId/runId 当 cache key,复刻 pi 的兜底缓存策略,让上游能命中 prompt cache。

## Background

诊断确认:上游本身支持缓存(pi 用同一上游能命中),根因是 AI SDK 默认不发缓存控制。pi 机制 = sessionId+cacheRetention 触发,按 API 协议发不同字段。本任务按 protocol 分支复刻。

上游(已查 DB):火山=anthropic(ark coding);ZEN-AI/硅基/阶跃/小米=openai-compatible。

## Requirements

- **R1. cache key 链路**:`StreamChatOptions.cacheKey`,chat 传 conversationId、网关传 runId、副任务(title/memory/compact)不传。
- **R2. anthropic(火山)**:注入 `cache_control` 断点(system + 末条消息)。
- **R3. openai-compatible**:注入 session affinity header(session_id / x-client-request-id / x-session-affinity)。
- **R4. openai**:注入 `promptCacheKey`。
- **R5. 前缀稳定性**:检查 system 拼装无每轮变化内容(时间戳等不前置)。

## Constraints

- AI SDK 边界:openai-compatible 的 anthropic 风格 cache_control 做不到;openai `prompt_cache_retention:24h` 做不到。
- 全部可选注入(cacheKey undefined 时回退现状),不破坏现有 stream/reasoning/tools。
- 纯运行时注入,无 schema/migration 变更。

## Out of Scope

- openai-compatible 的 anthropic 风格 cache_control(AI SDK 不支持)。
- `prompt_cache_retention:24h`。
- 统计/日志层改动(已支持 cacheReadTokens 读取)。

## Acceptance Criteria

- [ ] cacheKey 链路通:chat 传 conversationId、网关传 runId
- [ ] anthropic 请求含 cache_control;openai 含 prompt_cache_key;openai-compatible 请求含 session header
- [ ] cacheKey 缺失时不注入(回退现状,无副作用)
- [ ] `pnpm check` 通过
- [ ] 运行时:火山(anthropic)连续请求第 2 条 cache_read_tokens>0(待运行时验证)
