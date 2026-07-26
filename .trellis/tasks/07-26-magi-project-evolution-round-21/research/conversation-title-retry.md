# Conversation Title Retry Research

## Confirmed Failure Chain

- Chat 首条消息写 fallback 后，以 fire-and-forget 方式投递 `conversation-title`：`src/app/api/chat/route.ts:260-279`。
- worker 的标题 handler 直接 `await generateConversationTitle(data)`：`src/worker.ts:51-56`。
- queue adapter 逐个 `await handler(job.data)`；handler rejection 才能返回 pg-boss：`src/lib/infra/queue.ts:132-138`。
- 标题服务先检查会话及当前标题；会话缺失或标题已变化时返回 `null`，这是正确 no-op：`src/lib/conversation-title/service.ts:63-78`。
- `generateChat` 抛错被 `catch` 转换为 `null`，错误结果或空文本也返回 `null`：`src/lib/conversation-title/service.ts:93-104`。
- 清洗结果为空时再次返回 `null`：`src/lib/conversation-title/service.ts:106-107`。
- 最终写有 `conversationId + userId + 当前标题` 条件，迟到任务不会覆盖用户改名：`src/lib/conversation-title/service.ts:109-122`。

因此，数据库和 worker 链路本来具备 rejection 传播及幂等条件写，但模型失败在服务层被错误地伪装成成功 no-op。pg-boss 会确认任务，暂时性上游或路由故障恢复后也没有第二次执行机会，用户永久停留在 fallback 标题。

## Runtime Facts

- 当前本地 pg-boss 源码的队列默认值为 `retryLimit=2`、`retryDelay=0`、`retryBackoff=false`：`node_modules/pg-boss/src/plans.js:25-33`。
- pg-boss 只在 handler failure 时把未耗尽重试次数的 job 转成 `retry`：`node_modules/pg-boss/src/plans.js:806-835`。
- `generateChat` 已在内部完成路由和 key 级尝试；全部失败时返回带脱敏 `error` 的结果：`src/lib/stream.ts:673-705`。
- 现有标题测试只覆盖成功生成和用户改名保护：`src/lib/conversation-title/service.test.ts:101-150`。
- 现有 worker 测试覆盖注册、启动失败清理和关闭，不验证业务 handler rejection：`src/worker.test.ts:21-159`。

## Failure Classification

| Condition | Required result | Reason |
| --- | --- | --- |
| 首条消息为空 | `null` / ack | 不应创建有效标题任务 |
| 会话不存在 | `null` / ack | 重试不能恢复已删除或无权会话 |
| 当前标题不是默认值或本轮 fallback | `null` / ack | 用户改名或其他任务已完成 |
| `generateChat` 抛错 | generic rejection | 允许有限重试，且不泄露原始异常 |
| `generateChat` 返回 error/空文本 | generic rejection | 生成未完成，不能伪装成功 |
| 清洗后标题为空 | generic rejection | 本次模型输出不可用，有限重试可能恢复 |
| 条件更新零行 | `null` / ack | 生成期间用户已改名，正确 no-op |
| 数据库读写异常 | 原样 rejection | 现有行为已能触发队列重试 |

## Considered Designs

### 只删除 `generateChat` 外层 catch

不完整。`generateChat` 在常见的全部路由失败路径返回 `{ error }`，不会抛错；仍会被服务转换为 `null`。

### 把所有 `null` 都视为 worker failure

拒绝。`null` 同时承载会话缺失、用户改名和迟到任务等正确 no-op；盲目重试会制造无意义任务并弱化用户标题保护。

### 在 worker 中按返回值判断

拒绝。worker 无法从 `null` 区分正确 no-op 与生成失败；失败分类应留在拥有上下文的标题服务。

### 标题服务对生成失败抛通用内部错误

采用。保留明确 no-op 的 `null`，让真实生成失败 reject；错误文案不携带底层异常，已有 `generateChat` 负责安全日志。worker 和 queue adapter 无需新增分支，现有 pg-boss 有限重试即可生效。

### 同轮引入 producer outbox

暂不采用。它解决的是任务尚未持久化前的生产端崩溃/入队失败，需要新的持久状态、扫描与迁移；与已入队任务的错误确认不是同一边界。混入本轮会显著扩大回滚面，也不能由当前最小测试证明完整性。

## Verification Boundary

- 服务单测以失败先行方式覆盖 thrown、error result、无效文本、明确 no-op、成功更新和兼容入口。
- worker 单测捕获注册的 `conversation-title` handler，证明服务 rejection 不被 worker 吞掉。
- queue adapter 单测执行传给 pg-boss 的 callback，证明业务 handler rejection 原样冒泡且不会继续确认后续 job；本轮不改第三方 retry 配置。
- 全量测试和构建防止动态 import 边界回归。
- 本轮不启动服务、不访问真实上游、不运行 PostgreSQL 集成 harness；行为不涉及 schema 或数据库并发语义。
