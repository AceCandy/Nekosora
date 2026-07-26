# MAGI 项目进化第 23 轮

## Goal

修复文件对象已经持久化为 `pending`，但 pg-boss 投递失败且 Web fallback 在取得数据库租约前进程退出时永久卡住的问题，使数据库中的待处理文件最终能由 worker 自动接管。

## Background

- 上传先保存对象并插入 `file_objects(processing_status='pending')`，随后才尝试 `queue.send`（`src/app/api/upload/route.ts:89-124`）。
- queue 获取/投递失败后只 fire-and-forget 调用 `processFile`；上传响应仍立即成功（`src/app/api/upload/route.ts:128-139`）。进程可在异步函数执行到原子 claim 前退出，此时 DB 行仍是 `pending`。
- `processFile` 已能原子 claim `pending/error` 或 stale 活动状态，多个 worker/queue/scanner 竞态只有一方进入流水线（`src/lib/rag/process.ts:27-57`）。
- 当前恢复扫描仅选择租约为空/过期的 `extracting/embedding`，明确排除了 `pending`（`src/lib/rag/recovery.ts:11-35`）。因此上述行没有后续入口。
- 第 20 轮设计曾声明 Web fallback 进程退出可由同一扫描恢复，但实际查询未实现该契约（`.trellis/tasks/archive/2026-07/07-26-magi-project-evolution-round-20/design.md:113`）。

## Requirements

- 恢复扫描必须同时选择 `pending` 文件，以及租约为空/过期的 `extracting/embedding` 文件；`error` 和终态不得自动重试。
- 候选仍必须由 `processFile` 的单条条件 UPDATE 原子 claim；queue handler、Web fallback 与 scanner 并发时不得重复进入提取/嵌入流水线。
- 扫描必须保持启动立即执行、每 60 秒、单飞、顺序处理、单项失败隔离和单轮最多 25 条。
- 混合候选按 `created_at, id` 稳定排序，避免新增 `pending` 分支永久压住较早的 stale 活动记录。
- 为每分钟扫描追加 `pending(created_at, id)` 部分索引；不得改写已发布的 `0013`/`0014` 迁移。
- PostgreSQL 迁移必须追加 SQL、Drizzle journal/snapshot，并有迁移一致性测试。
- 保留上传接口的现有成功响应、queue 优先与 Web fire-and-forget fallback；扫描是最终恢复机制，不改变前端协议。
- 日志只包含文件 id 与脱敏短错误，不输出路径正文、连接串、密钥或完整异常对象。
- 更新文件存储规范，使 producer 退出前后的 `pending` 恢复契约与代码一致。
- 不修改文件处理租约时长、heartbeat、错误终态策略、pg-boss retry 参数或人工重试 UX。
- 不扫描 `docs/cankao`，不升级 Trellis，不触碰未识别 round-19 目录。

## Acceptance Criteria

- [ ] queue send 失败且 Web fallback 尚未 claim 的 `pending` 行可被下一次 worker 扫描处理到终态。
- [ ] queue send 成功但 handler 尚未 claim 时，scanner 可抢占；迟到 queue handler明确 no-op，提取只执行一次。
- [ ] 正常 queue handler 或 Web fallback 已取得 fresh 活动租约时，scanner 不重复处理。
- [ ] stale `extracting/embedding` 的原恢复行为保持；`error/done` 等非候选状态不被扫描。
- [ ] 混合候选稳定排序、单轮最多处理 25 条，单项失败不阻断后续候选。
- [ ] 新 pending 部分索引、`0015` SQL、journal 和 snapshot 与 schema 一致。
- [ ] PostgreSQL 集成测试至少证明持久 `pending` 被恢复、并发 scanner/直接处理只有一个 claim 胜者，且 25 条限制覆盖混合候选。
- [ ] 上传 fallback、文件租约、recovery scheduler、worker 生命周期和迁移回归测试通过。
- [ ] `pnpm check`、全量测试、生产构建、Trellis validate 与 `git diff --check` 全部通过。

## Out Of Scope

- 通用 background job/outbox 框架、管理后台重试入口或死信队列。
- 自动重试已进入 `error` 的业务失败文件。
- 修改对象存储补偿、上传大小限制、RAG 算法或 embedding 语义。
- 回填历史上已被用户删除或已进入终态的文件。
