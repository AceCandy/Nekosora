# MAGI 项目进化第 21 轮

## Goal

修复已入队的会话标题任务在模型生成失败后被 pg-boss 错误确认的问题，使有限重试能够真正生效，同时保留 fallback 标题和用户手动改名保护。

## Background

- 首条用户消息会先写入可读 fallback，再异步投递 `conversation-title` 任务（`src/app/api/chat/route.ts:260`）。
- worker handler 会等待 `generateConversationTitle`（`src/worker.ts:51`），queue adapter 也会把 handler rejection 交还 pg-boss（`src/lib/infra/queue.ts:132`）。
- `generateConversationTitle` 当前把 `generateChat` 抛错、错误结果和空结果都转换为 `null`（`src/lib/conversation-title/service.ts:93`）；worker 因此正常 resolve，pg-boss 不会使用现有有限重试。
- 会话不存在、标题已由用户修改等条件同样以 `null` 表示，但这些是应当正常确认的 no-op，不能与生成失败一起改成重试。
- 当前安装的 pg-boss 队列默认 `retryLimit=2`；本轮无需改变队列配置，只需恢复正确的 handler 失败语义。

## Requirements

- `generateChat` 抛错、返回 `error`、未返回文本或文本清洗后为空时，`generateConversationTitle` 必须 reject，使 worker job 进入 pg-boss 的有限重试。
- 投递给队列的异常必须使用不包含原始上游、连接或凭证细节的稳定通用文案；上游失败仍由现有 `generateChat` 日志链记录。
- 空首条消息、会话不存在、用户已修改标题等明确 no-op 必须继续返回 `null`，不调用不必要的模型或覆盖标题。
- 成功生成仍只能条件覆盖 `新会话` 或本任务携带的 fallback，不能覆盖用户手动标题。
- 兼容入口 `maybeGenerateTitle` 必须保留模型生成失败时的 best-effort 静默语义，但不得吞掉无关数据库或程序错误。
- worker 必须继续原样传播标题服务 rejection，queue adapter 交给 pg-boss 的 callback 也必须保持 reject；任何一层都不得记录后返回成功。
- 不修改 Chat 主回答行为、标题入队方式、pg-boss retry 配置、数据库 schema、API 响应或前端。
- 不扫描 `docs/cankao`，不升级 Trellis，不顺带修复记忆任务或引入通用 outbox。

## Acceptance Criteria

- [x] `generateChat` 抛错时标题服务以通用错误 reject，fallback 保持不变，错误中不包含原始异常文本。
- [x] `generateChat` 返回错误、空文本或清洗后空文本时标题服务 reject，而不是返回 `null`。
- [x] 会话缺失或用户手动改名仍正常返回 `null`，不调用模型且不覆盖标题。
- [x] 成功路径继续按配置模型生成并条件更新最终标题。
- [x] 兼容入口在标题生成失败时正常 resolve；worker handler 与 queue adapter 的 pg-boss callback 对同一失败保持 reject，供 pg-boss 重试。
- [x] 标题服务、worker 与 queue 相关回归测试通过。
- [x] `pnpm check`、全量测试、生产构建、Trellis validate 与 `git diff --check` 全部通过。

## Out Of Scope

- 为 Web producer 增加事务 outbox、持久投递状态或 fallback 扫描；fire-and-forget 入队失败是独立的生产端可靠性边界。
- 改变 `memory-extract` 的异常与幂等策略。
- 修改 pg-boss 队列默认重试次数、延迟、退避、过期时间或死信配置。
- 新增手动重试入口、任务管理界面或标题状态字段。
- 无实证的预防性重构和新功能扩展。
