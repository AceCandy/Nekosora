# MAGI 项目进化第 19 轮

## Goal

让 Chat 与网关生成不再因 best-effort 审计/用量写入永久 pending 而无法继续或结束，并确保 Chat heartbeat 在数据库迟滞与客户端取消时不会重叠或继续调度。

## Background

- `logUsage` 虽声明“失败不阻断主流程”，但 `getDb()` 或 insert 永久 pending 时不会进入 catch；`streamChat` 在 `finally` 中 await 它，导致生成器不结束（`src/lib/usage.ts:79-164`、`src/lib/stream.ts:368-418`）。
- run/tool 生命周期写入同样只捕获 reject，没有等待上限。`startRun` 位于流响应前，tool 写位于事件循环内，`finalizeRun` 位于 `[DONE]` 前，任一 pending 都会卡住对应阶段（`src/lib/chat/run-lifecycle.ts:161-225`、`src/app/api/chat/route.ts:317-345,613-632`）。收尾失败分支中标为尽力执行的 conversation 时间更新也仍被直接 await（`src/app/api/chat/route.ts:595-605`）。
- PostgreSQL Pool 仅配置 `max`；pg 8.22.0 的连接、查询和 statement timeout 默认均不限制。Drizzle 0.45.2 的 node-postgres session API 不暴露 AbortSignal。
- heartbeat 使用 `setInterval(() => void heartbeatRun())`。单次更新超过 30 秒时会重叠；`cancel()` 只 abort 上游，不立即清 timer（`src/app/api/chat/route.ts:331-345,613-645`）。

## Requirements

1. 明确标记为 best-effort 且会被主流程 await 的 DB 写入必须有统一、固定、可测试的等待上限；超时后调用方继续，底层 Promise 的晚完成不得产生 unhandled rejection。
2. 有界等待必须覆盖 `startRun`、`finalizeRun`、tool-call start/result、`logUsage` 与收尾失败分支的 conversation 时间更新；正常成功、立即失败、返回值和现有脱敏日志语义保持不变。
3. `startRun` 超时按失败返回 `false`，不启动 heartbeat；`finalizeRun` 超时按 best-effort 失败收敛，使成功消息持久化后仍可发送 `[DONE]`。
4. heartbeat 调度必须保证每个 run 同时最多一个调用；前一个调用 pending 时后续 tick 跳过，完成后才允许下一次续租。
5. request abort、ReadableStream `cancel()` 和所有 finally 路径必须立即且幂等地停止后续 heartbeat 调度；已进入 Drizzle/pg 的单次更新不伪装成可取消。
6. timeout timer 必须在 resolve/reject 后清理并 `unref()`，不得让 Node 进程因 best-effort 等待器保持存活。
7. 不修改 SSE 载荷、run 终态映射、用量分流、必要消息/Artifact 持久化或数据库 schema。
8. 不设置全局 PostgreSQL `statement_timeout/query_timeout`；当前 migrator 事务、向量查询和后台长任务不得被本轮的审计策略误杀。

## Acceptance Criteria

- [x] 永久 pending 的 start audit 在固定等待上限后返回 `false`，模型流可继续且不启动 heartbeat。
- [x] 永久 pending 的 finalize audit 在等待上限后返回；`[DONE]` 仍严格晚于必要消息持久化和 finalize 尝试，但不会无限等待审计库。
- [x] 永久 pending 的 tool-call 与 `logUsage` 写入在等待上限后释放调用方，超时日志不包含参数、结果、凭证或请求正文。
- [x] 收尾失败后的尽力 conversation 时间更新永久 pending 时，等待上限后仍会进入 run finalize、关闭流且不发送 `[DONE]`。
- [x] 快速成功与立即 reject 保持现有返回值、终态、用量表分流和错误隔离行为。
- [x] 多个 heartbeat tick 遇到未完成调用时只产生一次 DB 调用；该调用完成后下一 tick 可继续。
- [x] request abort 与 stream cancel 后不再产生新 heartbeat；重复停止不抛错，timer 使用 `unref()`。
- [x] timeout helper、run lifecycle、usage、route 均有失败先行的回归测试。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 与 Trellis validate 全部通过。

## Out Of Scope

- 不取消已提交给 Drizzle/pg 的查询；当前版本没有可用的 AbortSignal 接口，晚完成写入仍允许落库。
- 不为必要消息持久化设置跳过或伪成功路径；它仍是 `[DONE]` 前置条件。
- 不新增全局 DB/env 超时配置，不修改迁移执行方式或 `0012` 索引。
- 不实现 expired run janitor、终态补偿重试、DLQ、SSE 恢复或跨实例接管。

## Deferred Risk

- 应用层超时只停止等待，不释放底层 pg 查询；在数据库永久失联时，每个请求仍可能留下少量晚完成操作，且这些操作允许晚写入。全局连接/statement timeout 需要单独评估迁移与长查询兼容性。
- abort/cancel 可以停止 heartbeat 调度，但无法取消已经进入 pg 的一次 heartbeat；单飞约束将残余限制为每个 run 最多一次。
