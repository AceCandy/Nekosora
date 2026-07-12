# PRD: 剔除 SQLite dialect，收敛为 PostgreSQL-only

## 背景

当前数据库层是 **dual-dialect 工厂**：PostgreSQL（+pgvector）为主，SQLite（+sqlite-vec / better-sqlite3）作为零依赖回退。为此维护了：

- 两份同构 schema：`src/db/schema/pg.ts` + `src/db/schema/sqlite.ts`
- 两套迁移产物：`drizzle/pg/*` + `drizzle/sqlite/*`
- 两份 drizzle-kit 配置：`drizzle.pg.config.ts` + `drizzle.sqlite.config.ts`
- 运行时 dialect 切换：`src/lib/infra/db/index.ts` 的 `resolveDialect()` / `isPg` / `dbDialect`，惰性加载 pg 或 better-sqlite3 驱动
- 业务层 ~10 处 `if (isPg) {...} else { sqlite 路径 }` 分支（向量检索、时间桶、LIKE、事务、过期清理、MCP stdio、健康探针、运维展示）
- 向量双路径：pgvector `<=>` 算子 vs sqlite-vec / 内存余弦
- 队列双模式：pg-boss（PG）vs no-op（SQLite 回退）

实际只有 PostgreSQL 在用，双轨带来的成本：每次 schema/能力变更都要同步两份迁移 + 两套分支（参见 `AGENTS.md`「模型目录维护」对双方言迁移的硬性要求），业务分支读起来需要始终判断 dialect，`isPg` 标识贯穿全栈。

## 目标

收敛为 **PostgreSQL-only**：删除全部 SQLite 代码路径、驱动依赖、迁移产物、配置，业务层不再有任何 dialect 分支。后续 schema 变更只维护一份 PG 迁移。

## 范围

### 做
- 删 `src/db/schema/sqlite.ts`、`drizzle/sqlite/`、`drizzle.sqlite.config.ts`
- `src/lib/infra/db/index.ts` 收敛为 pg-only：删 `resolveDialect` / `isPg` / `dbDialect` / `DbDialect` / better-sqlite3 动态加载 / `_sqlite` / SQLITE_PATH
- `src/lib/infra/db/bootstrap.ts`：删 `isPg` 参数与 sqlite 分支（连通性、migrate 固定 pg）
- `src/lib/infra/env.ts`：删 `dbDialect`、`queueAvailable` 字段；`DATABASE_URL` 改为必填校验
- `src/lib/infra/queue.ts`：删 `resolveIsPg` / `noopAdapter`，固定 pg-boss（保留动态 import 防 Edge 打包）
- `src/lib/infra/vector.ts`：删 `toSqliteVec`、`serialize` 固定 `toPgVector`
- `src/instrumentation.ts` / `src/worker.ts`：删 dialect 默认值与 sqlite 早退
- 业务分支清理（删 sqlite/else 分支，保留 pg 实现）：
  - `src/app/(dash)/panel/actions.ts` `reorderMyModels` 事务
  - `src/lib/memory/recall.ts` `findSimilarMemory` / `vectorRecall`
  - `src/lib/memory/service.ts` `purgeExpiredProjectMemories`
  - `src/lib/rag/retrieve.ts` 占位 `void isPg`
  - `src/lib/repositories/error-log-repository.ts` `iLike`
  - `src/lib/usage-aggregate.ts` `bucketExpr` / `iLike`
  - `src/lib/mcp/registry.ts` `connectWithTimeout` 的 stdio 守卫
  - `src/app/(dash)/admin/operations/page.tsx` 时间窗 / DB 展示 / 队列展示
  - `src/app/healthz/ready/route.ts` 探针查询与 `dialect` 字段
  - `src/auth.ts` better-auth `provider` 固定 `"pg"`
- 依赖/配置：`package.json` 删 `better-sqlite3` / `@types/better-sqlite3` / `db:generate:sqlite` / `db:push:sqlite` / external 条目；`.env.example` 删 `SQLITE_PATH` / `DB_DIALECT`；`docker-compose.yml` 注释；`README.md`；`scripts/smoke/routing.smoke.ts`
- 测试：重写/调整所有 `isPg:false` mock 与 sqlite 路径测试为 pg 语义

### 不做（明确排除）
- **不提供 SQLite → PG 数据迁移工具**（已确认无 SQLite 部署/数据）
- 不改任何业务表结构、不动 PG 迁移历史（`drizzle/pg/*` 原样保留）
- 不改 better-auth schema（`auth-schema.ts` 是 dialect 中立描述，`pg.ts` 已具象化全部表）
- 不重构 `getDb()` 的动态 import 模式（Edge instrumentation 编译约束仍在）
- 不改 pg-boss 队列架构（只删 no-op 回退）

## 已确认的设计决策

1. **无 SQLite 数据要保** → 直接删全部 sqlite 代码与迁移产物，不做数据迁移
2. **`isPg` / `dbDialect` 彻底删除** → 不保留常量、不留死分支（业务代码所有 `if (isPg)` 直接去掉 else/sqlite 分支）
3. **能力开关直接删字段** → `env.ts` 的 `queueAvailable: dbDialect === "pg"` 字段删除（不保留恒 `true`）；`queue.ts` 的运行时探测函数 `queueAvailable()` 保留（探测 pg-boss 实际连接，语义独立、仍有价值）

## 验收标准

- `rg -n "isPg|dbDialect|DB_DIALECT|better-sqlite3|sqlite-vec|toSqliteVec|SQLITE_PATH" src scripts drizzle*.config.ts package.json` 在业务/配置代码中 **零命中**（仅可能在 git 历史/参考项目 docs/cankao 中存在）
- `pnpm typecheck` 通过（删除导出后所有 import 点已同步清理）
- `pnpm build` 通过（Edge instrumentation 编译不被 pg 驱动破坏）
- `pnpm test` 通过（sqlite 路径测试已重写为 pg 语义或删除）
- `src/db/schema/sqlite.ts`、`drizzle/sqlite/`、`drizzle.sqlite.config.ts` 不存在
- `package.json` 无 `better-sqlite3` / `@types/better-sqlite3`
- 本地 `docker compose up postgres` + `pnpm dev` 启动正常，bootstrap 走 pg migrate
- 运维页 `/admin/operations` 与 `/healthz/ready` 不再出现 SQLite 字样，队列固定 pg-boss
