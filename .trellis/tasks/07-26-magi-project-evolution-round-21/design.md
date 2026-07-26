# 会话标题任务失败重试设计

## Problem Statement

`conversation-title` worker job 已经持久化到 pg-boss，但标题服务把模型失败返回为 `null`。由于 handler 正常 resolve，队列把失败任务确认完成，现有有限重试完全失效。与此同时，`null` 还表示用户已改名等正确 no-op，不能简单把所有空结果都改成异常。

## Invariants

1. 只有已成功生成标题或确认无需再处理时，worker job 才能正常完成。
2. 模型调用失败或产生不可用结果时，worker job 必须 reject。
3. 迟到任务永远不能覆盖用户手动标题。
4. 进入队列失败记录的异常不得包含原始上游或凭证细节。
5. Chat 主回答不依赖标题任务成功，fallback 始终可用。

## Failure Contract

在标题服务内部增加仅用于区分“生成失败”的错误类型，错误消息固定为通用文案，不保留原始异常文本或 `cause`。

`generateConversationTitle` 的终态如下：

- 输入为空、会话缺失、当前标题已变化、最终条件更新零行：返回 `null`。
- `generateChat` 抛错、返回 `error`、没有文本或清洗后为空：抛出通用标题生成错误。
- 成功：返回并持久化清洗后的标题。
- 数据库和配置读取错误：沿用现有 rejection，不转换为 no-op。

worker 已直接等待该函数，queue adapter 也直接等待 worker handler，因此无需增加 worker catch。pg-boss 收到 rejection 后按当前队列默认值最多重试两次；每次执行前都会重查会话标题，用户改名或前一次实际成功后，后续投递会安全 no-op。

## Compatibility

`maybeGenerateTitle` 标注为兼容入口，其旧语义是在模型生成失败时保留 fallback 并正常完成。它只捕获新增的标题生成错误并返回；数据库、配置或其他程序错误仍继续抛出，避免扩大静默失败范围。

Chat route 继续先写 fallback 并异步入队，本轮不让标题基础设施故障阻断主回答。生产端尚未成功持久化 job 的失败不由本设计处理。

## Security And Observability

`generateChat` 已记录带 `taskKind=title` 的失败日志并对 provider secrets 脱敏。抛给 pg-boss 的错误只使用固定文案，既能驱动 retry，又不会把底层异常复制到队列失败记录或 worker console。

不增加新的日志写入，避免同一次标题生成失败重复落库。

## Verification Strategy

1. 服务测试先证明当前实现把 thrown/error/无效文本错误转换成 `null`，形成红灯。
2. 实现失败分类后，断言 rejection 文案稳定且不包含原始异常，fallback 未变化。
3. 保留用户改名和成功模型路由测试；新增兼容入口静默测试。
4. worker 测试捕获注册 handler，断言标题服务 rejection 原样传播。
5. queue adapter 测试执行传给 pg-boss 的批处理 callback，断言业务 handler rejection 原样冒泡且不继续确认后续 job。
6. 运行相关回归、`pnpm check`、全量测试和生产构建。

## Rollback

本轮不含 schema、迁移或外部 API 变更。回滚只需恢复标题服务、测试和规范；已进入 retry/failed 的 pg-boss job 保留现有数据，不需要清理数据库。

## Residual Risks

- Web 进程在 job 持久化前退出或 `send` 失败，仍可能只留下 fallback；这是独立 producer durability 问题。
- 固定默认模型或配置错误会消耗有限重试后进入 failed，但不会无限重试或覆盖用户标题。
- pg-boss 默认 retry 参数来自当前锁定版本；未来升级依赖时需重新核对队列契约。
