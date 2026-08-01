# File Worker Contract Extract

> 精选自 `.trellis/spec/backend/file-storage.md:437-472`，用于避免 context injection 的 32KB 截断。权威规范仍是原文件；本摘录只服务于本任务实施与审查。

## Scope And Signatures

- 本契约适用于 `processFile`、`file-process` worker、upload fallback 和 stale-file recovery。
- `processFile(fileId): Promise<void>` 是唯一 coordinator 入口，caller 不提供 storage metadata。
- `recoverStaleFileProcessing()` 每轮顺序处理最多 25 个 pending/stale active row。
- 当前 `startFileProcessingRecovery()` 负责立即及 60 秒 single-flight scan，并返回等待 active scan 的 stop；本任务将 timer ownership 迁入 generic worker runtime，但保持 recover round 语义。
- `startWorker()` 注册 queue handlers、启动 recovery 并拥有 startup/shutdown cleanup。

## Durable And Handler Contracts

- queue、Web fallback、多 worker 与 crashed process 可重叠；claim/lease token/database time 是唯一 ownership 证明。
- queue 现有 envelope 为 `{fileId,storagePath,mime}`，新 coordinator 只信任 fileId 与 claim RETURNING 的 canonical storage metadata。生命周期任务可删除冗余 transport fields，但不得重新把 caller metadata 变成事实源。
- 所有 post-claim write 匹配 file id、token、active status 与 fresh lease；zero-row 意味失权，禁止后续写。
- unsupported/empty/degraded embedding 是正常 terminal outcome；extraction/storage/chunk/persistence failure 写 stable error 后以固定 `文件处理失败，可重试` 且无 cause 的错误拒绝。
- lease loss 是 ownership no-op，不写 error；late external result 只能被 fencing 丢弃，不能声称已取消外部计算。
- `rag_reason` 只存 stable code；`embed_error` 和 processing log 使用 URL/secret redaction 且最多 200 字，不得包含 raw error/cause/stack/storage path/provider URL/connection string。

## Recovery And Lifecycle Contracts

- recovery 只扫描 pending 或 NULL/expired lease active row，排除 error/terminal；按 `created_at,id` 排序，limit 25，逐项处理并隔离单项失败，SELECT failure 拒绝整轮。
- scheduling 立即及每 60 秒执行，active round 不重叠，stop 清 timer 并等待 active scan。
- worker shutdown 先停 recovery 再停 queue；重复 signal 复用一个 shutdown Promise。
- startup failure 清理已启动 recovery 与 queue 并保留原始 error；shutdown cleanup failure 不阻断后续 cleanup，且 incomplete cleanup 非零退出。
- 本契约不需要 schema migration 或数据 reset；file state/lease 与 queue name 保持兼容。
