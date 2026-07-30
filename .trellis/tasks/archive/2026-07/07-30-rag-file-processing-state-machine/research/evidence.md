# RAG File Processing State Machine Evidence

## Scope

本研究记录架构深化路线图第二个 child 的现状证据、可复用契约、行为边界和规划取舍。只覆盖上传后文件处理、lease/fencing、chunks 与 stale recovery；通用 pg-boss lifecycle、新解析格式和检索算法不在此处重建。

## Current Processing Flow

- `src/app/api/upload/route.ts:89-109`：写对象存储后插入 `file_objects(processing_status='pending')`；DB insert 失败会 best-effort 删除已写对象。
- `src/app/api/upload/route.ts:119-139`：queue 可用时发送 `file-process`，否则 fire-and-forget 调用 `processFile`；成功 HTTP 固定返回 `{fileId,filename,status:'processing'}`。
- `src/worker.ts:37-43`：queue handler 直接 await `processFile(fileId,storagePath,mime)`。
- `src/lib/rag/process.ts:27-217`：单函数拥有 claim、heartbeat、extract、chunk、embed、chunks transaction、terminal/error write 和 cleanup。
- `src/lib/rag/recovery.ts:11-47`：扫描 pending 或 stale active 候选，逐个调用同一 `processFile`；candidate select 与 claim 重复状态谓词。
- `src/lib/rag/recovery.ts:49-81`：立即 + 60 秒 single-flight scheduler，timer unref，stop 等待 active scan。

## Existing Ownership Contract

- `src/lib/rag/process.ts:33-57`：一条 conditional UPDATE claim `pending/error` 或 lease NULL/expired 的 `extracting/embedding`，写随机 UUID 与 `now()+2 minutes`；空 RETURNING 直接 no-op。
- `src/lib/rag/process.ts:59-65`：owned predicate 同时匹配 file id、lease id、active status 与 `lease_expires_at > clock`。
- `src/lib/rag/process.ts:71-100`：renew 与普通 stage update 均使用 owned predicate；heartbeat 30 秒且 single-flight。
- `src/lib/rag/process.ts:169-199`：transaction 内先 owned renew，再 delete/insert chunks，最终以 `statement_timestamp()` freshness 写 done 并 clear lease；最终 miss 抛错回滚整个 transaction。
- `src/lib/rag/process.ts:200-213`：lease loss 静默返回；其他异常尝试 owned error terminal。

这些机制已经提供正确 fencing，但所有权条件是函数局部闭包，recovery 与未来调用方无法只依赖一个公开 repository contract。

## Writer Audit

- `src/lib/rag/process.ts:33-213` 是 processing status、lease、extract/embed metadata、rag reason 和 chunks replacement 的唯一完整生产 writer。
- `src/app/api/upload/route.ts:99-109` 只创建 pending row，不写 post-claim 字段。
- `src/lib/knowledge-base/service.ts:60-91` 只更新 `knowledgeBaseId`，与 lease/state 无关。
- recovery、retrieve 与 context 只读。未发现其他生产代码直接替换 `file_chunks` 或写 processing lease/status。

因此 repository cutover 可覆盖一个明确、有限的 writer set；upload pending insert 保留在 upload transaction/compensation 边界。

## Database And Data Impact

- `src/db/schema/pg.ts:652-690`：`file_objects` 已有 text `processingStatus`、nullable token/expiry、extract/embed/RAG metadata 与 `ragReady`。
- `src/db/schema/pg.ts:682-690`：stale active partial index 以 expiry/createdAt 排序，pending partial index 以 createdAt/id 排序。
- `src/db/schema/pg.ts:694-712`：`file_chunks` 以 fileId cascade FK 关联，embedding 为 nullable `vector(1024)`。
- `drizzle/pg/0000_baseline.sql:1314-1322,1347-1349`：lease columns、active NULL lease backfill、stale 与 pending indexes 已在基线。
- `src/lib/rag/file-processing-lease-migration.test.ts:7-63` 与 `pending-file-recovery-migration.test.ts:7-44` 已锁定 SQL/journal/snapshot。

现有 token + expiry 足以成为 fencing fact；本任务无需 schema/migration。`file_objects`、chunk text、embedding 与 storage objects 都是业务数据，不能因架构整理清空或批量重置。

## Status And Consumer Contract

- `src/lib/rag/process.ts:105-136`：unsupported/image/PDF/Office 与 empty text 收敛为 `done/ragReady=false`。
- `src/lib/rag/process.ts:139-198`：embedding failure/unavailable 保留无向量文本 chunks，`embedStatus=error|skipped`，最终仍 `done/ragReady=false`。
- `src/lib/rag/process.test.ts:178-196` 明确断言 embedding error 的 degraded terminal 行为。
- `src/lib/rag/retrieve.ts:114-128` 与 `src/lib/knowledge-base/service.ts:95-115` 只查询 `ragReady=true` 文件。
- `src/lib/rag/context.ts:40-48,68-125`：full-context 可读取未 ready 的文本 chunks；RAG 模式通过 retrieve gate 排除它们。
- `src/app/(dash)/panel/knowledge/page.tsx:21-28` 未展示 processing/rag error 字段；upload API 也不暴露内部状态。

把 embedding failure 改为 retryable error 会改变既有状态语义，却没有 retry budget/backoff。规划因此保持 degraded terminal，只把 extraction/storage/chunk/persistence failure 变成可识别的 retryable rejection。

## Error And Privacy Evidence

- `src/lib/rag/process.ts:151` 把原始 embedding error message 写入 `embed_error`。
- `src/lib/rag/process.ts:202-208` 直接 console 输出 Error，并把原始 message 写入 `rag_reason`。
- `src/app/api/upload/route.ts:128-135` 直接记录 queue/fallback Error。
- `src/lib/rag/recovery.ts:41-44,60-64` 已采用 `redactErrorMessage(...).slice(0,200)`，可作为当前项目模式。
- `src/lib/redaction.ts:30-68` 支持按敏感字段、query、authorization/bearer 与调用方已知 secret 清理未知异常，并且不传递 cause/stack。

新 state contract 应统一 stable code 与安全短消息，避免每个 adapter 各自决定是否保存原始异常。

## PostgreSQL Test Matrix

`src/lib/rag/process.pg.test.ts` 已覆盖：

- `73-101`：expired extracting takeover 并完成；
- `103-124`：fresh active lease 不抢占；
- `126-150`：并发 stale processing 只有一个 extractor；
- `152-212`：claim 等父行锁，锁释放后重新判断 predicate；
- `214-249`：旧 token 条件写 rowCount=0；
- `251-315`：chunk insert 失败保留旧 chunks；
- `317-388`：statement-time lease 过期回滚 replacement；
- `390-456`：stale/pending recovery 及 scanner/direct single winner；
- `458-520`：单候选 claim failure 不阻塞后续且日志不泄露 PostgreSQL URL；
- `522-581`：混合候选 limit 25，排除 error/done。

主要缺口：真实 PG 中 owner A 在 embedding in-flight 时被 owner B 接管并完成，随后 A 晚返回的全链 fencing；createdAt 相同的 id tie ordering；第二轮处理第 26 条。

## Test Harness

- `scripts/test-file-processing-lease-pg.ts:4-10` 只允许随机 `nekusora_file_lease_test_<16hex>` 数据库名。
- `scripts/test-file-processing-lease-pg.ts:47-70` 创建临时库、安装 pgvector、跑完整 Drizzle migrations，并只把生成 URL 放入 child env。
- `scripts/test-file-processing-lease-pg.ts:72-83` 在 finally 终止目标库 session、force drop、关闭 admin connection。
- `scripts/test-file-processing-lease-pg.ts:87-92` 对 harness 错误中的 PostgreSQL URL 做最终脱敏。

该 harness 是本任务真实并发 gate，不允许用长期共享库或跳过的 test 结果替代。

## Applicable Specs

- `.trellis/spec/backend/file-storage.md`：上传 storage compensation、recoverable fenced processing、worker/recovery 与 user-owned RAG 文件契约。
- `.trellis/spec/backend/database-guidelines.md`：PostgreSQL/Drizzle transaction、数据库时钟、动态 import 与 migration 不改写原则。
- `.trellis/spec/backend/error-handling.md`：稳定错误边界与客户端/服务端错误契约。
- `.trellis/spec/backend/logging-guidelines.md`：日志分类、脱敏和数据库观测边界。
- `.trellis/spec/backend/directory-structure.md`：RAG 领域代码归属 `src/lib/rag`，route/worker 保持薄适配。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：API -> queue -> coordinator -> DB -> retrieval 的单一数据契约与边界核对。

由于完整 `file-storage.md` 略超过单文件注入上限，`research/file-storage-contract.md` 仅为 sub-agent context 精选上述三个相关 scenario 并保留源行号；权威性仍属于原 spec，实施完成后必须更新原 spec。

## Decisions And Rejected Alternatives

### Chosen: FileId-Only Coordinator

claim 本来就必须更新并 RETURNING parent row。顺便返回 storagePath/mime 可消除 queue payload 的重复事实源，并让 recovery/direct 完全相同。三参数 processing wrapper 被拒绝，因为它继续允许 caller 暗示 metadata 权威性；现有 queue envelope 仍保留三字段以支持旧 worker 与安全回滚，但新 adapter 不转发冗余 metadata。

### Chosen: Typed State Commands + Database Repository

只把 `ownedWhere` 提成 helper 仍允许任意 patch 和重复 terminal SQL。状态 command 负责“允许发生什么”，repository 负责“数据库如何证明”，coordinator 负责“何时调用外部工作”，三者可以独立测试。

### Chosen: Existing Lease Columns, No Migration

随机 token 每次 claim 都替换，且参与所有 owned write；新增 version 或 enum 不增加本任务核心保证。无迁移也避免触碰 RAG 业务数据。

### Chosen: Retryable Rejection Without Error Scanner

worker 必须看到真实处理失败，不能错误 ack；但 scanner 自动扫 error 在没有 retry budget/backoff 时会无限重试。先建立 generic retryable error contract，统一 policy 留给下一子任务。

### Rejected: Retry Embedding Failure Automatically

embedding degraded 当前保留全文可用性，且缺乏有界重试状态。改变它会扩大产品行为和数据模型，违反本 child 的 retrieval compatibility。

## Remaining Known Risks

- queue envelope 暂时保留冗余 path/mime；必须用 coordinator signature 和 tests 防止未来代码重新依赖它们。
- extract/embed API 不支持 AbortSignal，fencing 只能阻止错误提交，不能节省已开始的外部计算。
- `processing_status` 缺 DB CHECK；本任务依靠 typed commands、单 writer repository 与 tests 约束，数据库级约束需单独迁移设计。
- embedding degraded 不自动恢复；后续若增加“重新处理”，必须同时设计 retry budget、backoff 与用户可见状态。
