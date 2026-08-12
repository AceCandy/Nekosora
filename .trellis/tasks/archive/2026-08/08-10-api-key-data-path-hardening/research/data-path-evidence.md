# API Key 数据路径证据

## 当前实现

- `packages/core/src/lib/keys.ts:126-131` 的 `listKeys` 全列查询 `api_keys`。
- `apps/web/src/app/(dash)/panel/keys/page.tsx:19-76` 展开行对象并传入 Client Component；TypeScript props 类型不会在运行时删除 `keyHash`。
- `packages/core/src/lib/keys.ts:164-178` 使用 legacy/current 两种 `keyPrefix` 等值条件查询 enabled Key 与 active owner，随后以 `safeEqual` 比较完整 hash。
- `packages/db/src/schema.ts:114-138` 没有 `keyPrefix` 索引；`parentId` 只有普通列与索引。

## 父子关系结论

- `parentId` 只在创建 master/sub Key 时写入，不参与鉴权、路由、绑定、禁用或配额。
- `packages/core/src/lib/routing.ts:74-89` 和 `106-125` 以 `keyKind === "sub"`、当前 `apiKeyId` 和 `key_model_bindings` 实施模型限制。
- 当前没有 Key 物理删除入口；禁用主 Key 不影响子 Key。
- 因此保留 master/sub 权限类型，删除没有执行语义的 `parentId`。

## 迁移证据

- PostgreSQL 迁移目录为 `drizzle/pg`，下一编号为 `0011`；必须同步 `meta/_journal.json` 与新 snapshot。
- `bootstrapDatabase()` 由 Web、Gateway、Worker 调用，三个进程都会在启动时自动执行迁移。
- 旧 runtime 全列读取 `api_keys`，因此删列必须先完成新 runtime 排空部署，再单独迁移。
- 仓库已有 migration SQL/journal/snapshot 合同测试，以及创建隔离 PostgreSQL 数据库后执行全部迁移的测试脚本模式。
- 用户选择本任务直接物理删列；发布采用停止 Web/Gateway/Worker 的维护窗口，不做滚动兼容。
- 完整回滚依赖迁移前一致性数据库备份，以同时恢复原始 `parent_id` 数据和 Drizzle 迁移账本；手工补列只能恢复旧 runtime 兼容。

## 验证边界

- 静态测试可证明 schema、SQL、journal、snapshot 和 DTO 投影。
- 真实 PostgreSQL 才能证明迁移执行、表锁行为和查询计划实际引用 prefix 索引。
