# File Storage Contract Context

## Purpose

`.trellis/spec/backend/file-storage.md` 是本任务的权威规范，但文件略超过 Trellis 单文件 context 注入上限。此文件只为 implement/check agent 提供与本 child 直接相关的精选上下文；源规范仍是事实源，实施时若本摘要与源文件冲突，以源文件为准。

## Upload Compensation

Source: `.trellis/spec/backend/file-storage.md:207-252`.

- 在 storage access 前完成 DB/schema 与 client-supplied relationship authorization。
- `StorageDriver.put` 成功后，`file_objects` insert 进入 compensation boundary。
- insert 明确失败时，对同一 generated storage key 恰好尝试一次 delete，然后重新抛出原 DB error。
- delete 也失败时只记录 cleanup error，不能替换原 DB error。
- DB preflight、put、insert、delete 与 queue 的调用顺序必须由 route tests 锁定；成功 insert 不触发 delete。

本 child 只修改 insert 后的 queue/fallback adapter，不改变上述顺序和错误优先级。

## Recoverable Fenced Processing

Source: `.trellis/spec/backend/file-storage.md:434-493`.

- claim 是一条 conditional UPDATE：允许 `pending/error`，或 lease NULL/expired 的 `extracting/embedding`；写随机 token 与 `now()+2 minutes`，empty RETURNING 是 no-op。
- post-claim write 必须同时匹配 file id、token、active status 与 `lease_expires_at > now()`；zero-row 后禁止任何后续 DB write。
- heartbeat 每 30 秒 single-flight、timer unref；zero-row 或 DB error 都视为 lease loss；所有出口 clear timer 并 await in-flight renewal。
- extract/embed 当前无 cancellation signal；lease loss 只 fencing 晚结果，不声称取消外部计算。
- unsupported、empty 与普通 error terminal 只能在 owned 条件下 clear lease；embedding failure 保留文本 chunks 且 `rag_ready=false`。
- chunk replacement 必须在一个 transaction 中 renew/lock parent、delete old chunks、insert batches of 50、以 `statement_timestamp()` freshness 写 done/clear lease；失败整体 rollback。
- recovery 只扫 pending 或 stale active，排除 error/terminal；按 `created_at,id`，limit 25，顺序处理并隔离单项失败。SELECT failure 由 scheduler 捕获，立即 + 60 秒 single-flight，stop 等待 active scan。
- partial indexes、真实 PostgreSQL single-winner/row-lock/fencing/rollback/recovery tests、upload/worker/full quality gates 都必须保留。

本 child 有意识升级两点：`processFile` 只接 fileId，并由 claim RETURNING canonical storagePath/mime；retryable processing failure 在 owned error write 后向 worker reject，而不是吞错。实现完成后必须回写源规范签名与 failure propagation，不能让本研究摘要代替 spec update。

## User-Owned RAG Files

Source: `.trellis/spec/backend/file-storage.md:522-565`.

- client-supplied file/KB IDs 即使来自 authenticated caller 仍是不可信资源标识。
- context、retrieve、KB expansion 与 storage reads 都必须以 `file_objects.user_id=userId` 约束。
- empty retrieve fileIds 只表示当前用户的 rag-ready corpus，不是全库。
- unauthorized 与 missing ID 都收敛为空，不泄露其他用户资源是否存在。
- 本 child 不改变 retrieve/context/KB owner predicates；回归 tests 必须保持 owner + rag-ready 条件。

## Implementation And Review Gate

- Upload route tests：compensation 顺序、固定 HTTP response、兼容 queue envelope、fallback fileId-only coordinator 调用与安全日志。
- Repository/coordinator tests：所有 owned predicate、canonical metadata、failure codes、heartbeat 与 atomic chunks。
- Recovery/worker tests：candidate filter/order/limit、single-flight/stop、generic rejection propagation。
- Retrieval/context/KB tests：owner 与 rag-ready consumer contract 不变。
- PostgreSQL harness：single winner、old owner late result、row-lock predicate recheck、chunk rollback 与 stable scan ordering。
