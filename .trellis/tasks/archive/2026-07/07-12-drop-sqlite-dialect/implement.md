# Implement Plan: 剔除 SQLite dialect，收敛为 PostgreSQL-only

> 每阶段尾部是验证 gate，过了再进下一阶段。改造点行号见 `design.md`，实施时以实际磁盘内容为准。
> 全程不动 `drizzle/pg/*`、不动业务表结构。

## 阶段 0: 基础设施工厂收敛

- [ ] 0.1 `src/lib/infra/db/index.ts`：删 `DbDialect`/`resolveDialect`/`dbDialect`/`isPg`/`_sqlite`；`loadSchema` 固定 pg；`getDb` 删 better-sqlite3 分支；`closeDb` 删 sqlite 清理；删 `export { dialect }`；头注释重写（保留动态 import 说明）
- [ ] 0.2 `src/lib/infra/db/bootstrap.ts`：`bootstrapDatabase` 去 `isPg`；`checkConnection`/`runMigrations` 去 `isPg` 参数与 sqlite 分支，固定 pg
- [ ] 0.3 `src/lib/infra/env.ts`：删 `dbDialect`/`queueAvailable` 字段与 import；`DATABASE_URL` 改必填校验
- [ ] 0.4 `src/lib/infra/queue.ts`：删 `resolveIsPg`/`noopAdapter`；`buildAdapter` 固定 pg-boss（保留动态 import 与 `queueAvailable()` 探测）
- [ ] 0.5 `src/lib/infra/vector.ts`：删 `toSqliteVec`/`isPg` import；`serialize` 固定 `toPgVector`
- [ ] 0.6 `src/instrumentation.ts`、`src/worker.ts`：删 dialect 默认值与 sqlite 早退
- **gate**：`pnpm typecheck`（预期此时业务层 import `isPg`/`dbDialect` 处会报错 → 进入阶段 1 清理；若想绿需两阶段合并跑，可先记下报错点）

## 阶段 1: 业务层 isPg 分支清理（删 else/sqlite，保留 pg）

- [ ] 1.1 `src/app/(dash)/panel/actions.ts`：`reorderMyModels` 删 sqlite transaction 分支；删 `isPg` import
- [ ] 1.2 `src/lib/memory/recall.ts`：`findSimilarMemory` + `vectorRecall` 删 sqlite 内存余弦分支；删 `isPg` import；确认 `cosineSimilarity` 仍被 `getMemoryDiagnostics` 使用则保留
- [ ] 1.3 `src/lib/memory/service.ts`：`purgeExpiredProjectMemories` 删 `unixepoch` 分支；删 `isPg` import
- [ ] 1.4 `src/lib/rag/retrieve.ts`：删 `isPg` import、`void isPg`；评估删 `void distanceToSimilarity` 占位
- [ ] 1.5 `src/lib/repositories/error-log-repository.ts`：`iLike` 固定 `ilike`；删 `like`/`isPg` import
- [ ] 1.6 `src/lib/usage-aggregate.ts`：`bucketExpr` 固定 `date_trunc`；`iLike` 固定 `ilike`；删 `like`/`isPg` import
- [ ] 1.7 `src/lib/mcp/registry.ts`：`connectWithTimeout` stdio 守卫去 `&& !isPg`；删 `isPg` import
- [ ] 1.8 `src/auth.ts`：`provider` 固定 `"pg"`；删 `isPg` import（保留 `getDb`）
- **gate**：`pnpm typecheck` 通过（所有 `isPg`/`dbDialect` import 点已清）

## 阶段 2: 展示与探针层

- [ ] 2.1 `src/app/(dash)/admin/operations/page.tsx`：lastHourCalls 固定 pg；`metricDb` InfoCard 固定 PostgreSQL；两处 DepRow 固定 pg-vector / pg-boss；去 `env.dbDialect`/`env.queueAvailable`
- [ ] 2.2 `src/app/healthz/ready/route.ts`：删 `isPg` import；`execute` 统一 `sql\`select 1\``（补 `sql` import）；`dialect` 字段删除或固定
- **gate**：`pnpm typecheck` 通过

## 阶段 3: 删除文件

- [ ] 3.1 删 `src/db/schema/sqlite.ts`
- [ ] 3.2 删 `drizzle/sqlite/`（整目录）
- [ ] 3.3 删 `drizzle.sqlite.config.ts`
- **gate**：`pnpm typecheck` 通过（确认无残留 import `@/db/schema/sqlite`）

## 阶段 4: 依赖与配置

- [ ] 4.1 `package.json`：删 `better-sqlite3`/`@types/better-sqlite3`/`db:generate:sqlite`/`db:push:sqlite`/external 条目；`pnpm install` 更新 lockfile
- [ ] 4.2 `.env.example`：删 `SQLITE_PATH`/`DB_DIALECT`；`DATABASE_URL` 标必填
- [ ] 4.3 `docker-compose.yml`：注释去 SQLite 回退表述
- [ ] 4.4 `scripts/smoke/routing.smoke.ts`：sqlite env 改 pg 依赖
- [ ] 4.5 `README.md`：部署章节去 SQLite
- **gate**：`pnpm build` 通过（Edge instrumentation 编译验证）；`rg -n "isPg|dbDialect|DB_DIALECT|better-sqlite3|toSqliteVec|SQLITE_PATH" src scripts drizzle*.config.ts package.json .env.example` 在业务/配置代码零命中

## 阶段 5: 测试改造

- [ ] 5.1 `src/lib/infra/db/bootstrap.test.ts`：sqlite env 重写为 pg mock
- [ ] 5.2 `src/lib/memory/recall.test.ts`：`isPg:false` 改 pg mock；sqlite 内存余弦断言重写或删除，确认 pg `<=>` 路径有覆盖
- [ ] 5.3 `panel/actions.test.ts`、`compact/service.test.ts`、`memory/extract.test.ts`：mock 删 `isPg` 字段
- **gate**：`pnpm test` 通过

## 阶段 6: 端到端验证

- [ ] 6.1 `docker compose up postgres -d`，确认 `.env.local` 有 `DATABASE_URL`
- [ ] 6.2 `pnpm dev` 启动，bootstrap 日志走 pg migrate，无 sqlite 字样
- [ ] 6.3 访问 `/admin/operations` 与 `/healthz/ready`，展示均为 PostgreSQL + pg-boss
- [ ] 6.4（可选）`pnpm worker` 启动 pg-boss 正常
- **gate**：启动 + 探针 + 运维页均正常

## 回滚点
- 每阶段独立 commit，失败时 `git revert` 对应 commit
- 全程无数据副作用（无 SQLite 数据、不动 PG 迁移历史）

## 验证命令速查
```bash
pnpm typecheck
pnpm build
pnpm test
rg -n "isPg|dbDialect|DB_DIALECT|better-sqlite3|sqlite-vec|toSqliteVec|SQLITE_PATH" src scripts drizzle*.config.ts package.json .env.example
```
