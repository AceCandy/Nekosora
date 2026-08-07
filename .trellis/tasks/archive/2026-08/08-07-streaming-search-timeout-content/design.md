# 流式搜索超时与工具轮正文设计

## Boundaries

本任务修改三条相邻但独立的数据流：

1. Hosted Search：`searchWeb` -> `executeHostedModelSearch` -> AI SDK `streamText`。
2. 工具轮正文：`streamChatWithTools` -> completion coordinator -> `/api/chat` SSE -> Web store。
3. 搜索尝试：`SearchAttempt` -> process trace/SSE -> Web projection -> `ChatMessageItem`。

不修改公开 `/v1/*` 流协议、模型目录或数据库 schema。

## Hosted Search Watchdog

- 外部 Provider 保留 10 秒 attempt timeout。
- Hosted Search 不再接收固定 10 秒 attempt timeout，由内部 watchdog 管理：
  - 初始 30 秒等待有效上游事件；
  - 首个有效事件后切换为 30 秒 idle timeout；
  - 文本、推理、来源、Hosted 工具输入/调用/结果等上游进度重置 idle timer；本地 start 不计入；
  - 自然结束时清理 timer；外层 signal 与 watchdog signal 使用 `AbortSignal.any` 合并。
- `streamText().fullStream` 由 adapter 主动消费，结束后读取 `text`、`sources` 和 `usage`，保持现有返回结构与来源校验。

## Fallback Window

- 使用 60 秒绝对 deadline 约束是否开始下一后端，而不是使用会中止所有在途工作的总 `AbortSignal.timeout`。
- 外部 Provider 的 attempt signal 合并外层 signal、10 秒 attempt timeout 与 deadline 剩余时间。
- Hosted Search 仅合并外层 signal 与内部 watchdog；一旦开始返回，可跨越 fallback deadline 完成。
- Hosted Search 失败后再次检查 deadline：仍有时间则继续，已到期则停止。

该设计保证 GPT 有 30 秒首包机会，同时给正常首包超时后的 Tavily 留出回退窗口。

## Tool-Round Text Retraction

- `streamChatWithTools` 为每个模型 step 累计已向外发送的正文。
- 收到该 step 的第一个 `tool-call` 时立即发送一次内部 `text-retract { text }`，其中 `text` 是此前已发送正文的精确拼接值；该工具轮后续正文 delta 不再向外透传。
- completion coordinator 仅在当前聚合正文以该值结尾时移除后缀，并继续向内部 Chat SSE 发送撤回事件。
- Web SSE handler 收到撤回后先 flush 当前 delta，再按精确后缀移除；不得直接清空整条消息，以保护 continue generation 之前的正文。
- 普通无工具 step 不发送撤回事件，因此保持现有实时流式体验；同一工具轮只撤回一次。
- 公开 `/v1/*` adapter 忽略该内部事件，保持协议兼容。

## Search Attempt Semantics

- `WebSearchTraceAttemptOutcome` 增加 `skipped_after_timeout`。
- 仅共享 timeout Map 命中分支使用新值；配置缺失、路由缺失等继续使用 `unavailable`。
- 实时 SSE、历史安全投影和 UI i18n 同步接受新值；旧记录保持原样。

## Rollback

- Hosted 流式执行可独立回退到 `generateText` 与固定 attempt timeout。
- `text-retract` 是内部增量事件，删除生产者与消费者即可回退，不涉及数据迁移。
- 新 outcome 为 JSON trace 的向后兼容枚举扩展，无数据库回滚步骤。
