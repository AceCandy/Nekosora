# 实施计划

## 1. 失败先行测试

- 扩展 PostgreSQL recovery 测试：pending 可恢复、pending 与直接处理并发单 winner、混合候选上限 25、error/done 排除。
- 新增 `0015` 迁移一致性测试：部分索引 SQL、journal idx/tag、snapshot prevId 与 schema 索引形状。
- 保留 upload route、scheduler 和 worker 测试作为对外行为与生命周期回归。

验证：新增 pending 恢复与迁移测试在实现前按预期失败。

## 2. Schema 与追加迁移

- 在 `fileObjects` 增加 `file_objects_pending_processing_idx(created_at, id)` pending 部分索引。
- 用 Drizzle 生成命名 `0015_pending_file_recovery`，不改写 `0013/0014`。
- 修正任何仍假设“自身迁移永远是 journal 最后一项”的历史迁移测试，按 idx/tag 定位目标项。

## 3. 完整恢复谓词

- 扩展 `recoverStaleFileProcessing` 查询包含 pending 或 stale active。
- 按 `createdAt, id` 稳定排序、limit 25、顺序交给 `processFile` 原子 claim。
- 保留 scan SELECT 失败传播、单候选失败脱敏记录并继续的现有行为。

## 4. 规范与独立复核

- 更新 `file-storage.md` 的 recovery signatures、contracts、错误矩阵和测试要求。
- 独立只读复核 pending/queue/scanner 竞态、error 终态、索引/迁移和 worker 生命周期。

## 5. 完整门禁

```bash
pnpm vitest run src/lib/rag/process.pg.test.ts src/lib/rag/recovery.test.ts src/lib/rag/pending-file-recovery-migration.test.ts src/app/api/upload/route.test.ts src/worker.test.ts
pnpm check
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-23
git diff --check
```

本轮不启动开发服务、不访问真实对象存储或模型上游。PG 集成测试如配置测试数据库会自行创建随机临时库并在 `finally` 删除。
