# Stale File Processing Research

## Confirmed Failure Chain

- `processFile` 只以 `id + processingStatus IN (pending,error)` claim；无返回立即退出：`src/lib/rag/process.ts:23-33`。
- claim 后的状态更新只按 `fileId`：`src/lib/rag/process.ts:35-36`。
- chunk 删除和批量插入不受 owner token 保护：`src/lib/rag/process.ts:83-98`。
- 正常完成与 catch 收敛也只按 `fileId`：`src/lib/rag/process.ts:100-113`。
- 上传先持久化 `pending`，队列异常时启动 fire-and-forget fallback：`src/app/api/upload/route.ts:99-137`。
- worker handler 直接 await `processFile`：`src/worker.ts:20-27`。
- `file_objects` 只有处理阶段字段和 `createdAt`，没有租约、更新时间或 fencing token：`src/db/schema/pg.ts:565-595`。
- 现有测试只覆盖 pending/error 原子 claim、no-op 和 unsupported 流转：`src/lib/rag/process.test.ts:58-118`。
- 现行规范明确不恢复 stale 活动行：`.trellis/spec/backend/file-storage.md:434-473`。

因此，进程在 claim 后直接退出不会运行 catch，记录永久活动；后续 queue retry 或 fallback 调用因 claim 条件不满足直接返回。仅允许过期状态重新 claim 仍不正确，因为旧执行者恢复后能按 `fileId` 删除新 chunks 或覆盖状态。

## Existing Patterns

- Chat run 使用 PostgreSQL `now() + interval '2 minutes'` 的租约，并以 30 秒单飞 heartbeat 调度：`src/lib/chat/run-lifecycle.ts:28`、`src/app/api/chat/route.ts:332-365`。
- PostgreSQL schema 使用 nullable `timestamptz` 与部分索引：`src/db/schema/pg.ts:391-415`。
- `0012_add_run_lease` 展示追加迁移、活动行回填、journal/snapshot 连续和迁移测试惯例：`drizzle/pg/0012_add_run_lease.sql`、`src/lib/chat/run-lease-migration.test.ts:7-67`。
- Drizzle transaction callback 是项目认可的 PostgreSQL 事务模式：`.trellis/spec/backend/database-guidelines.md` 的 Transactions 章节。

## pg-boss Runtime Facts

当前安装版本的本地源码显示：

- 未显式配置时 `retryLimit=2`、`expireInSeconds=900`：`node_modules/pg-boss/src/migrationStore.js:103-107`。
- handler resolve 后调用 `complete`；超时或抛错才调用 `fail`：`node_modules/pg-boss/src/manager.js:207-215`。

结论：queue retry 不能替代独立 stale 扫描。重试在有效业务租约期间可能 no-op 并完成；Web fallback 崩溃更可能没有 durable job。

## Considered Designs

### 仅开放 stale 状态 claim

拒绝。没有 token 时旧执行者仍能晚写状态与 chunks。

### token + expiresAt，但 chunks 不进事务

拒绝。逐批 insert 期间失租约会留下混合/半批 chunks，且旧执行者可能删除新结果。

### 为每条 chunk 增加 generation/token

可实现，但当前不需要。以 owned 条件 UPDATE 锁住父 `file_objects` 行，再在同一事务内 delete/insert/finalize，已经能阻止 stale 接管与旧 token 写入；新增 chunk schema 会扩大迁移和查询面。

### scanner 重置状态后重新入队

拒绝。数据库状态重置与 pg-boss send 不是同一原子操作；send 失败会制造新的 pending 卡死，周期扫描也可能重复入队。

### scanner 直接调用 `processFile`

采用。扫描只提供候选，`processFile` 仍以数据库 CAS 决定唯一 owner；进程退出后下轮扫描继续恢复，不需要跨系统事务。

## Deployment Constraint

nullable schema 只保证旧 runtime 不因字段缺失报错，不能让不认识 token 的旧执行者受到 fencing。新 stale scanner 与旧 worker/fallback 混部会有数据竞态，因此上线必须排空旧执行者后再启用扫描。迁移把遗留活动行设为立即过期，启动后的新 worker 统一接管。

## Verification Capability

- 当前环境没有 `DATABASE_URL` 进程变量，但项目 `.env.local` 可由现有 `tsx --env-file-if-exists` 方式加载，连接探测成功且未输出连接串。
- 当前数据库角色具备创建临时数据库的权限，可为本轮建立隔离 PG 集成门禁并在结束后删除。
- Docker CLI 存在但当前用户无 daemon socket 权限，因此不依赖启动新容器；使用已经运行的 PostgreSQL 服务，不触碰现有业务数据库。
- 为避免人工传错 `TEST_DATABASE_URL` 或测试失败遗留数据库，验证必须由仓库 harness 内部生成固定前缀随机库名，并以 `try/finally` 终止残留连接、删除精确目标；不得把连接串写入日志或文件。
