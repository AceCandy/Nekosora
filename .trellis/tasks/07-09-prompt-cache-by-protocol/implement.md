# Implement — 按协议注入 prompt 缓存控制

## 执行顺序

### Step 1 — 验证 streamText system cacheControl 传法(前置)
- 查 AI SDK v5 文档/源码:streamText 的 system/instructions 如何挂 `providerOptions.anthropic.cacheControl`。
- 确认是在 system 文本对象上,还是 messages 的 role:system 上。
- verify:确定一个可用传法,再进 Step 4。

### Step 2 — cache key 传递链路
- `stream.ts` `StreamChatOptions` 加 `cacheKey?: string`。
- `/api/chat/route.ts`:streamChat/streamChatWithTools 传 `cacheKey: conversationId`。
- `/v1/chat/completions/route.ts`:传 `cacheKey: runId`。
- 副任务(memory/title/compact)不传。
- verify:typecheck。

### Step 3 — registry.ts openai-compatible session header
- `buildLanguageModelWithKey(route, apiKey, cacheKey?)`:openai-compatible 分支 headers 改为函数,cacheKey 存在时注入 session_id/x-client-request-id/x-session-affinity。
- `buildLanguageModel(route)` 不带 cacheKey(保持现状,probe 等无 key 场景)。
- stream.ts 调 `buildLanguageModelWithKey(route, tryKey, cacheKey)`(传 opts.cacheKey)。
- verify:typecheck。

### Step 4 — stream.ts streamWithRoute 按 protocol 注入
- anthropic:system + 末条消息打 cacheControl(按 Step 1 确认的传法)。
- openai:`providerOptions.openai.promptCacheKey = cacheKey`(合并到现有 providerOptions)。
- verify:typecheck。

### Step 5 — 前缀稳定性检查
- 查 system prompt 拼装(chat/orchestrator 或 stream separateSystem):确认指令卡/知识库拼装顺序固定,无每轮变化内容在前。
- 记录发现;若有明显破坏前缀的,小修。

### Step 6 — 全量校验 + 运行时验证
- `pnpm check`。
- 运行时:用火山(glm-5.2)发连续两条消息,查 usage_logs.cache_read_tokens 第 2 条是否 >0。
- verify:lint/typecheck 过;火山第 2 条请求 cached_tokens>0(运行时,可能需用户配合)。

## 回滚点
- 每步可选注入,cacheKey undefined 即回退现状。
- Step 3/4 按 protocol 独立,可单独撤销。
