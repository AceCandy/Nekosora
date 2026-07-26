# Pending 文件持久恢复设计

## Problem Statement

`file_objects.pending` 已是可靠的持久状态，但恢复器没有消费它。queue send 与 Web fallback 都发生在 DB insert 之后，且 fallback 未被 await；进程在 `processFile` claim 前退出会留下永久 pending。核心问题不是缺少另一份 job 表，而是现有 durable state 的恢复谓词不完整。

## Invariants

1. `pending` 表示文件尚未被任何执行者 claim，必须最终进入 worker 恢复路径。
2. queue、Web fallback、scanner 都只提供执行机会，唯一执行权由 `processFile` 的数据库 claim 决定。
3. `error` 是当前业务终态，不能因扩大扫描集合而形成无限自动重试。
4. 单轮候选有界且稳定，新增 pending 不得破坏 stale 活动任务恢复。

## Selected Design

扩展 `recoverStaleFileProcessing` 的单次查询：

```text
status = pending
OR (
  status IN (extracting, embedding)
  AND (lease IS NULL OR lease <= database now)
)
```

候选按 `created_at, id` 排序并限制 25 条，随后继续顺序调用 `processFile`。不先把行重置或改状态，不另行 enqueue；`processFile` 已用条件 UPDATE 把 pending/stale 原子转换为带随机 token 的 fresh `extracting`，并发 loser 在任何外部处理前返回。

保留 upload 的 immediate fallback。它在 queue 故障时仍可降低延迟；如果进程退出，pending scanner 接管；如果它先 claim，scanner 和迟到 queue handler看到 fresh lease并 no-op。由此 queue send 成功也不再是唯一恢复保证。

## Index And Migration

现有 `file_objects_stale_processing_idx(lease_expires_at, created_at)` 只覆盖活动状态。为 pending 分支追加 `file_objects_pending_processing_idx(created_at, id) WHERE processing_status = 'pending'`，使周期查询可通过两个部分索引过滤候选，再对最多相关行稳定排序。

使用 Drizzle 生成 `0015_pending_file_recovery` SQL/journal/snapshot，不修改历史迁移。迁移只建索引，不回填或改写业务数据；部署迁移后新 worker 即可发现存量 pending。

## Compatibility And Rollback

- API、SSE、前端和文件状态枚举无变化。
- 新索引可先于 runtime 部署；旧 runtime 忽略它。
- 新 scanner 与旧 queue/Web executor 可并行，因为已有 token claim 是唯一执行权。
- 代码回滚后索引可保留，无行为影响；删除索引需后续追加迁移。

## Verification Strategy

- 失败先行的 recovery/PG 测试插入 pending 行并证明 scanner处理到终态。
- 并发测试同时启动直接 `processFile` 与 recovery，断言提取只执行一次或最终状态只有一个 owner路径。
- 混合 pending/stale/error/done 数据验证谓词、稳定有界扫描与旧行为。
- 迁移测试断言部分索引、journal/snapshot 连续。
- upload route 现有 queue failure/fallback 测试保持不变，证明对外协议未改变。

## Risks

- 持续失败的数据库 claim 仍会在每轮被选中；现有单项隔离和 25 条背压限制影响，本轮不引入 dead-letter。
- 周期恢复依赖至少一个 worker 存活；健康检查目前只证明 queue backend 可初始化，不证明 worker liveness。
- PostgreSQL planner 对 OR 分支的具体计划依赖数据分布；两个部分索引提供候选访问路径，但本轮不声称固定执行计划。
