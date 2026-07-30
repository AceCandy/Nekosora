# RAG 文件处理状态机

## Goal

建立单一 RAG processing coordinator 与 lease repository，把文件处理的 claim、数据库时钟租约、heartbeat、阶段转换、fencing、chunk 原子替换、失败分类和 stale recovery 收敛成一个可证明的状态机。worker、上传 fallback 与恢复扫描调用 coordinator 时只提交 `fileId`，不能重新解释处理状态或把 queue metadata 当作权威输入。

## User Outcome

- 同一文件被 queue、Web fallback、多个 worker 或恢复扫描并发触发时，只有一个有效 owner 能提交处理结果。
- 旧 owner 丢失租约后即使外部提取或 embedding 晚返回，也不能覆盖新 owner 的 chunks、错误或终态。
- 处理失败具有稳定、脱敏的诊断语义；可重试失败能被调用方识别，unsupported、空文本和 embedding 降级不会被误判为成功可检索。
- 上传响应、文件归属、全文上下文与 RAG 检索行为保持不变。

## Confirmed Facts

- `src/lib/rag/process.ts:33-65` 已使用随机 lease token、PostgreSQL `now()` 和 owned predicate，但 claim、heartbeat、阶段写、错误写及 chunk transaction 全部嵌在一个函数中，没有可独立复用的 repository/state contract。
- `src/lib/rag/process.ts:169-199` 已把租约复核、旧 chunk 删除、新 chunk 插入和 `done` 终态放在同一事务，并以 `statement_timestamp()` 做最终 freshness gate。
- `src/lib/rag/recovery.ts:15-45` 重复候选状态谓词后调用 `processFile`；最终仲裁仍依赖 `processFile` 内的条件 claim。
- `src/app/api/upload/route.ts:119-139` 与 `src/worker.ts:37-43` 向处理入口传入 `storagePath/mime`，但这些值已有 `file_objects` 权威记录，可由 claim 一并返回。
- `src/lib/rag/process.ts:151,202-208` 会把原始异常写入 `embed_error` / `rag_reason` 并直接输出 console；当前没有统一脱敏和长度上限。
- `src/lib/rag/retrieve.ts:114-128` 与 `src/lib/knowledge-base/service.ts:95-115` 只消费 `rag_ready=true` 文件；embedding 失败当前保留文本 chunks、标记 `done/rag_ready=false`，全文上下文仍可读取文本。
- 现有 `processing_lease_id`、`processing_lease_expires_at`、状态字段及 pending/stale partial indexes 已满足统一状态机，无需新增 PostgreSQL 列或重建数据。

## Requirements

- R1. `processing-coordinator` 是文件处理阶段顺序和结果分类的唯一所有者；upload、worker 与 recovery 只能调用同一 `processFile(fileId)` 入口。
- R2. `processing-state` 以穷尽类型定义 `pending|error|extracting|embedding|done` 的允许转换、阶段结果和稳定失败代码；调用方不得散落字符串状态判断。
- R3. `processing-repository` 独占 recoverable scan、claim、renew、owned transition、owned failure 和 chunk replacement/terminal write 的数据库条件；所有所有权判断只使用 PostgreSQL clock 与随机 lease token。
- R4. claim 必须原子返回当前数据库记录中的 `storagePath/mime`；为保持滚动部署/回滚安全，queue envelope 继续携带现有三字段，但新 worker 只把 `fileId` 传给 coordinator，path/MIME 不参与处理决策。
- R5. lease loss 或 heartbeat 数据库异常都表示无法证明所有权：立即停止后续领域写入，丢弃晚到的 extract/embed 结果，不写 error 或 terminal；外部 API 当前无 AbortSignal 时不虚假声称取消计算。
- R6. chunk replacement、`rag_ready`、稳定 `rag_reason` 和 lease clear 必须在一个短事务中完成；先锁 parent row，再用锁后新语句时间校验并续租；入口和最终 statement-time freshness 任一失败均回滚旧 chunk 删除与新 chunk 插入。
- R7. 失败矩阵固定为：unsupported/image/PDF/Office 与 empty text 是 terminal `done`；embedding unavailable/failure/返回数量不一致是保留文本 chunks 的 degraded `done`；extraction/storage-read/chunking/persistence 异常是 retryable `error` 并向调用方抛出通用错误；lease loss 是 ownership no-op。
- R8. `rag_reason` 只保存稳定代码，`embed_error` 与 console 只允许保存/输出脱敏且最多 200 字符的消息；retryable rejection 固定为无 `cause` 的通用消息。原始 Error、stack、连接串、storage path、provider URL/header/credential 不得越过 coordinator 边界。
- R9. recovery 保持 pending 或 stale active 候选、`created_at,id` 稳定排序、单轮 25 条、逐文件顺序隔离、立即 + 60 秒 single-flight 调度，以及 stop 等待当前 scan；`error` 不由 scanner 无限自动重试。
- R10. 保持上传鉴权与 HTTP 状态、成功响应 `{fileId, filename, status:"processing"}`、文件属主隔离、全文上下文和 `rag_ready` 检索门槛；不新增前端状态或文件格式。
- R11. 最终实现删除旧 `src/lib/rag/process.ts` 编排和旧三参数处理入口，不保留新旧 coordinator 双轨；现有 queue envelope 保持兼容，使新旧 Web/worker 可滚动部署和整体回滚。
- R12. 本任务不新增迁移、不清空或重置 `file_objects`、`file_chunks`、向量、原始对象或用户数据；活动 lease 继续通过过期恢复自然收敛。

## Acceptance Criteria

- [x] upload fallback、queue handler 与 recovery 均只调用 `processFile(fileId)`；claim 返回的数据库 `storagePath/mime` 是唯一处理输入。
- [x] 删除 `processing-state` 或 `processing-repository` 会使 direct/recovery 的共同 contract tests 失败，且生产代码不存在另一套 owned predicate 或 chunk replacement。
- [x] 状态转换表覆盖 pending/error/stale active claim、extracting、embedding、terminal/degraded/error 与 lease-loss no-op；非法转换在单元测试中被拒绝。
- [x] 两个并发 owner 只有一个进入有效流水线；旧 owner 在 extraction 或 embedding 晚返回后不能写阶段、chunk、error 或 terminal。
- [x] heartbeat pending 时保持 single-flight；zero-row 或数据库异常均失去本地所有权，停止计时并等待在途 renewal 后退出。
- [x] chunk transaction 在锁后重新校验 freshness；insert 失败、锁等待跨 expiry 和最终 `statement_timestamp()` 失败都保留旧 chunks，成功时 replacement、终态与 lease clear 同一提交。
- [x] retryable processing failure 写入 stable code 后向 worker/recovery/fallback 传播通用脱敏错误；unsupported、empty 和 embedding degraded 仍按现有终态与检索契约收敛。
- [x] recovery 继续稳定排序、limit 25、逐文件隔离、排除 fresh lease/error/done，scheduler 无重叠且 stop 等待当前扫描。
- [x] DB 只含 stable code/安全短消息；coordinator rejection 无 raw message/cause；worker handler、recovery、queue dispatch 与 upload fallback console 测试逐一证明凭据、连接串、provider URL 和原始 storage path 不泄露且文本不超过上限。
- [x] 现有 upload、worker、RAG context/retrieve、knowledge-base、lease migration 和 PostgreSQL 并发测试保持通过；真实 PG 覆盖 late owner、锁等待跨 expiry 与 rollback。
- [x] `rg` 证明旧 `process.ts`、旧三参数调用和重复 lease SQL 不再可达；lint、typecheck、全量 tests、production build 与 Trellis validate 通过。

## Key Decisions

- 采用 `processing-state` + `processing-repository` + `processing-coordinator` 三个窄边界，而不是继续在 `process.ts` 内增加 helper。状态/失败语义、数据库 fencing 与外部计算编排分别只有一个所有者。
- `processFile` 破坏性收敛为 fileId-only；权威文件元数据由 claim 返回，避免 stale/tampered queue payload 驱动 storage 读取。queue envelope 暂不缩减，因为保留字段不再构成事实源，却能保持滚动部署与回滚兼容。
- embedding failure 保持 degraded `done`，因为现有全文上下文仍可使用文本 chunks，且 R8 要求检索/可见性不变；本任务不引入无退避、无上限的自动重嵌入循环。
- retryable processing failure 在 owned error write 后向调用方 reject，修复 worker 错误确认；通用 retry/dead-letter 策略仍由后续 Worker/queue lifecycle 任务统一。
- 不增加 schema 或迁移。当前 token + expiry 已是 fencing token；为架构分层新增数据库列只会制造无收益的数据风险。
- 不保留旧 coordinator wrapper 或双状态机；保持现有单一 queue envelope，无 payload 版本分支。新旧 Web/worker 都能消费同一消息，回滚不需要转换或清空队列积压。

## Dependencies

- 已完成并归档：`07-30-chat-completion-transaction-boundary`。
- 本任务输出稳定 fileId-only coordinator 调用、兼容 queue handler、recovery adapter 和 retryable failure contract，供 `07-30-worker-queue-lifecycle` 统一注册、retry policy、drain 与 shutdown。

## Out Of Scope

- pg-boss 通用 start/stop、全局 retry/dead-letter、signal/drain 编排。
- 新解析格式、PDF/Office 引擎、chunking/embedding 算法或向量维度替换。
- 自动重试 embedding degraded 文件、增加 retry counter/backoff 表字段或前端“重新处理”产品功能。
- 重做上传 HTTP、文件管理 UI、知识库 UI、RAG 检索排序或全文上下文策略。
- 清空、重建或批量重置任何 RAG/用户业务数据。

## Data Impact

- 无 PostgreSQL schema、migration、journal 或 snapshot 变更。
- 现有 `file_objects` / `file_chunks` 只经过正常 fenced 条件写与原子 replacement；不清表、不回填、不重建向量。
- 代码回滚不需要数据库回滚；活动 token 由同一既有租约语义保护，最迟在两分钟 lease window 后可由旧/新实现重新 claim。
