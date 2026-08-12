# OpenAI-compatible stream_options 自动降级设计

## Boundary

数据流保持为：入口协议解析 -> IR -> Gateway execution -> route adapter -> AI SDK Provider。

- 入站兼容：OpenAI Chat parser 接受并校验标准 `stream_options.include_usage`，但不把该协议控制字段写入 IR 或透传上游。网关当前流式编码器始终返回最终 usage，本次保持既有响应布局，避免把入口 400 修复扩大成响应协议迁移。
- 出站兼容：上游能力学习只发生在 Gateway execution 与 OpenAI-compatible adapter 边界，不进入 model catalog。

## Detection

在 `gateway-execution/policy.ts` 增加窄匹配函数：仅接受 HTTP 400，并同时匹配 `stream_options` 字段名与明确的不支持语义。继续读取 AI SDK 直接错误及 `lastError.responseBody/data`，与现有工具能力检测保持同一错误展开方式。

## Capability Persistence

`providers` 增加内部可空布尔列 `supports_stream_usage`：

- `null` 或 `true`：`createOpenAICompatible({ includeUsage: true })`。
- `false`：`createOpenAICompatible({ includeUsage: false })`，SDK 序列化时省略 `stream_options`。
- 第一次明确拒绝时，先把当前 `ResolvedProvider` 改为 `false`，让同一请求的 adapter 重建后立即省略字段；再以 `provider.id + provider.baseUrl` 为条件 best-effort 持久化 `false`。
- Provider 管理更新统一把该字段重置为 `null`，让新配置重新探测；不增加可见 UI 控件。

不使用 model catalog：`stream_options` 是具体上游 endpoint 的兼容行为，不是模型官方语义。字段位于 Provider 而不是 route，因为同一 Base URL 的请求解析器通常共享该兼容能力；最坏情况只是该 Provider 的其他模型省略可选 usage 字段，不影响生成。

## Retry And Telemetry

`ExecuteGatewayOptions` 增加专用检测与学习 hook。Engine 在 adapter 抛错后按以下顺序处理：

1. 确认未提交响应、当前 route 匹配且本 route 尚未进行兼容性重试。
2. 将第一次请求记录为 failed attempt，错误代码标记为 `stream_options_not_supported`。
3. 调用学习 hook，立即更新当前 Provider 对象并按 ID + Base URL 落库；数据库失败不得覆盖当前请求结果。
4. 不更新 breaker，将同一个 key 插入下一次尝试位置。
5. adapter 下一次调用重新构造模型，从当前 Provider 对象读到 `includeUsage=false`。
6. 重试成功时记录第二条 success attempt，并只 finalize 一次 execution。

Engine 用 execution 级布尔门禁保证整个逻辑请求最多重试一次。若第二次仍失败，恢复既有错误分类、key/route 故障转移和 breaker 规则。已提交任何不可撤回事件时禁止重试。

## Compatibility

- OpenAI Chat 客户端发送标准 `stream_options.include_usage` 不再被入口拒绝；未知子字段仍按现有严格参数策略拒绝。
- 官方 OpenAI 与其他 route API format 不注册该降级条件。
- 非流式 `generateText` 不生成 `stream_options`，无需重试。
- 支持该字段的上游从不进入降级路径，usage 保持不变。
- 数据库能力按 Provider 隔离；Provider 管理更新后恢复待探测。

## Rollback

回滚 runtime 时保留新增可空列即可，旧 runtime 会忽略它并恢复固定 `includeUsage=true`。若完整回滚 schema，另行追加迁移删除该列，不改写已发布迁移。
