# Design: 剔除 SQLite dialect，收敛为 PostgreSQL-only

> 改造原则：每个 `if (isPg) { PG路径 } else { SQLite路径 }` 都**只删 else 分支、保留 PG 实现**；删除的导出（`isPg`/`dbDialect`/`dialect`）所有 import 点同步清理。行号基于当前磁盘内容，实施时以实际为准。

## 1. 基础设施层

### 1.1 DB 工厂 `src/lib/infra/db/index.ts`
- 删 `DbDialect` type（L19）、`resolveDialect()`（L21-26）、`dbDialect`（L28）、`isPg`（L29）
- `loadSchema()`（L48-63）：删 `if (isPg)` 分支，固定 `const mod = await import("@/db/schema/pg")`
- `getDb()`（L72-104）：删 else 分支（L87-96：better-sqlite3 动态 import、`SQLITE_PATH`、`pragma`）；保留 pg 池（`max:10`）。删 `_sqlite` 变量（L38）及其在 `closeDb` 的清理（L123-125、L128）
- `closeDb()`（L107-130）：仅保留 `_pool.end()`
- 删末行 `export { dbDialect as dialect }`（L132）
- **导出契约变化**：不再导出 `isPg` / `dbDialect` / `dialect`。`AnySchema` / `getDb` / `getSchema` / `closeDb` 保留
- 文件头注释（L1-17）重写为 pg-only 语义，但**保留「动态 import 驱动避免 Edge 打包 pg」的说明**（约束仍在）

### 1.2 启动 `src/lib/infra/db/bootstrap.ts`
- `bootstrapDatabase()`（L22-48）：`const { getDb, getSchema } = await import(...)`（删 `isPg`）；L30 `if (isPg) ensurePgvector` → 直接 `await ensurePgvector(db)`
- `checkConnection(db, isPg)`（L54-71）→ `checkConnection(db)`：删 else 分支（better-sqlite3 `.run`），固定 `db.execute(sql\`select 1\`)`；日志去 `(pg)`
- `runMigrations(db, isPg)`（L77-99）→ `runMigrations(db)`：删 else 分支（better-sqlite3 migrator + `drizzle/sqlite`），固定 pg migrator + `drizzle/pg`

### 1.3 环境契约 `src/lib/infra/env.ts`
- 删 `import { dbDialect }`（L5）
- `EnvInfo`（L7-17）：删 `dbDialect`、`queueAvailable` 字段
- `getEnvInfo()`：删 `dbDialect`、`queueAvailable: dbDialect === "pg"`
- `validateEnv()`（L41-51）：`if (info.dbDialect === "pg" && !DATABASE_URL)` → `if (!process.env.DATABASE_URL) errors.push("未配置 DATABASE_URL（仅支持 PostgreSQL）。")`
- **消费方同步**：`operations/page.tsx`、`healthz/ready`（见 §2.8、§2.9）

### 1.4 队列 `src/lib/infra/queue.ts`
- 删 `resolveIsPg()`（L13-17）、`noopAdapter`（L35-50）
- `buildAdapter()`（L52-98）：删 L53 `if (!resolveIsPg()) return noopAdapter`，固定走 pg-boss
- **保留**：变量路径动态 import pg-boss（L57-65，Edge 约束）、`queueAvailable()` 运行时探测函数（L113-116，被 healthz 用）
- 文件头注释（L1-12）重写

### 1.5 向量 `src/lib/infra/vector.ts`
- 删 `import { isPg }`（L12）、`toSqliteVec`（L23-26）
- `serialize()`（L28-30）→ 固定 `return toPgVector(v)`
- 文件头注释（L1-11）重写为 pgvector-only

### 1.6 进程入口
- `src/instrumentation.ts`（L28-33）：删 dialect 变量与三元默认值；日志 `DB=pg` 固定，`Queue=需运行 pnpm worker` 固定
- `src/worker.ts`（L10-14）：删 dialect 判断与 `if (dialect !== "pg") return` 早退；直接进入 pg-boss（无 `DATABASE_URL` 时 `buildAdapter` 抛错合理）

## 2. 业务层 isPg 分支（删 else/sqlite，保留 pg）

| 文件 | 位置 | 改法 |
|---|---|---|
| `panel/actions.ts` | `reorderMyModels` L402-434 | 删 else 分支（better-sqlite3 同步 transaction L418-434），保留 pg async `db.transaction`；删 `isPg` import |
| `memory/recall.ts` | `findSimilarMemory` L89-130 | 删 sqlite 内存余弦分支（L108-129），保留 pg `<=>`（L90-106） |
| `memory/recall.ts` | `vectorRecall` L193+ | 删 sqlite 分支，保留 pg `<=>` + 7 天过滤 |
| `memory/service.ts` | `purgeExpiredProjectMemories` L46-54 | 删 else（`unixepoch()` L50-53），保留 pg `NOW() - INTERVAL '7 days'` |
| `rag/retrieve.ts` | L14、L224-226 | 删 `isPg` import、`void isPg`（L225）；评估删 `void distanceToSimilarity`（L226，仅占位）。`doRetrieve` 已统一内存余弦，无 dialect 分支 |
| `repositories/error-log-repository.ts` | `iLike` L247-250 | `return isPg ? ilike : like` → 固定 `ilike(col, ...)；删 `like`、`isPg` import |
| `usage-aggregate.ts` | `bucketExpr` L43-50 | 删 sqlite `strftime` 分支（L48-49），保留 pg `date_trunc` |
| `usage-aggregate.ts` | `iLike` L385-388 | 固定 `ilike`；删 `like`、`isPg` import |
| `mcp/registry.ts` | `connectWithTimeout` L107 | `if (row.transport === "stdio" && !isPg)` → `if (row.transport === "stdio")`；删 `isPg` import |
| `auth.ts` | `buildAuth` L53 | `provider: isPg ? "pg" : "sqlite"` → `provider: "pg"`；删 `isPg` import（保留 `getDb`） |
| `admin/operations/page.tsx` | L57-59 | 删 `env.dbDialect === "pg" ? now()-interval : unixepoch()-3600` 三元，固定 `now() - interval '1 hour'` |
| `admin/operations/page.tsx` | L69 | `metricDb` InfoCard：固定值 `"PostgreSQL"`（去掉 `env.dbDialect.toUpperCase()` 与 SQLite hint） |
| `admin/operations/page.tsx` | L78 | `DepRow metricDb`：固定 `"PostgreSQL + pgvector"` |
| `admin/operations/page.tsx` | L82 | `DepRow depQueue`：`env.queueAvailable ? ...` → 固定 `"pg-boss (PostgreSQL)"` |
| `healthz/ready/route.ts` | L10、L35、L81 | 删 `isPg` import；L35 `execute(isPg ? "select 1" : "select 1")` → `execute(sql\`select 1\`)`（注：原两分支同为 select 1，统一即可，需补 `sql` import）；L81 `dialect: env.dbDialect` → 删除或固定 `"pg"` |

### 2.x 实施时确认项
- `recall.ts` 的 `cosineSimilarity` 来源：`getMemoryDiagnostics`（L172-184）用 O(n²) 内存余弦做重复诊断，**不依赖 dialect，保留**。确认 `cosineSimilarity` 是本地定义还是 import，若仅 sqlite 分支用则需保留给 diagnostics
- `healthz/ready` L35 原本 `execute(isPg ? "select 1" : "select 1")` 两分支字面相同，统一时注意 `sql` 标签模板需 import（当前文件 L88-89 有 `void getSchema`，说明 sql 可能未 import，确认）
- `panel/actions.ts` 删 else 后，确认 `db.transaction` 的返回签名（pg 为 async，已 await）

## 3. better-auth 影响（无需改动 schema）
- `auth.ts` 仅 provider 字段固定 `"pg"`
- `src/db/auth-schema.ts` 是 dialect 中立描述（字段语义），被 `pg.ts` import 具象化，删 sqlite 不影响
- `auth:migrate` 脚本（`better-auth-cli`）pg-only 下正常
- ⚠️ 若曾有 SQLite 库的 better-auth 表，其 DDL 与 pg 不同——已确认无 SQLite 部署，不处理

## 4. 删除清单
- `src/db/schema/sqlite.ts`（整文件）
- `drizzle/sqlite/`（整目录：18 个迁移 + meta snapshot + journal）
- `drizzle.sqlite.config.ts`

## 5. 依赖与配置
- `package.json`：
  - deps 删 `better-sqlite3`（L45）
  - devDeps 删 `@types/better-sqlite3`（L75）
  - scripts 删 `db:generate:sqlite`（L19）、`db:push:sqlite`（L21）
  - `pnpm.overrides` / external（L95 附近）删 `better-sqlite3` 条目
- `.env.example`：删 `SQLITE_PATH`（L12）、`DB_DIALECT` 说明（L9）；`DATABASE_URL` 改标注为必填，回退说明删除
- `docker-compose.yml`：注释 L1-3「而非默认的 SQLite」改写为 pg 是唯一数据库
- `scripts/smoke/routing.smoke.ts` L15-16：`DB_DIALECT=sqlite` + `SQLITE_PATH` → 改为 pg（依赖 `DATABASE_URL`，smoke 跑前需 pg 就绪）
- `README.md`：部署章节 SQLite 回退说明删除

## 6. 测试改造
| 测试 | 现状 | 处理 |
|---|---|---|
| `src/lib/infra/db/bootstrap.test.ts` L71-72 | 设 `DB_DIALECT=sqlite` + `SQLITE_PATH` 测 sqlite bootstrap | 重写为 pg mock（或若仅测 migrate 编排，改 pg 路径） |
| `src/lib/memory/recall.test.ts` L101 | `isPg:false`，注释「测 SQLite 路径」 | 改 pg mock；保留的断言聚焦 pg `<=>` 路径 |
| `src/app/(dash)/panel/actions.test.ts` L138 | mock 返回 `isPg:false` | 删 `isPg` 字段（mock 接口不再有） |
| `src/lib/compact/service.test.ts` L111 | `isPg:false` | 同上 |
| `src/lib/memory/extract.test.ts` L99 | `isPg:false` | 同上 |

> 这些 test 的 `isPg:false` 多为 mock db 接口字段；删导出后 mock 类型同步。recall.test 若断言依赖 sqlite 内存余弦的数值，需重写为 pg 语义或删除该断言。

## 7. 迁移策略与回滚
- **无数据迁移**：纯代码删除 + 分支收敛，无 DDL 变更、无数据搬运
- **回滚形状**：`git revert` 单个/多个 commit 即可完整回滚；不涉及任何不可逆数据副作用（本地无 SQLite 数据）
- **PG 迁移历史原样保留**：`drizzle/pg/*` 与 `_journal.json` 不动，后续 schema 变更从 `0019` 续编

## 8. 风险
- **Edge 编译**：删 better-sqlite3 后，`getDb`/`bootstrap`/`queue` 的动态 import 模式必须保留，否则 Turbopack 在 instrumentation Edge 编译时把 pg 拉入导致 `util/types` 解析失败。typecheck + build 双 gate 兜底
- **测试盲区**：`recall`/`rag` 的 sqlite 内存余弦路径删除后，pg `<=>` 路径若无对应单测覆盖，向量召回行为差异（DB 算子 vs 内存）可能暴露。阶段 4 需确认 pg 路径有覆盖
- **smoke 脚本**：改 pg 后 `routing.smoke.ts` 跑前需 pg 就绪，CI/本地流程要同步
- **better-auth**：provider 固定 pg 后，若有遗漏的 sqlite 适配器引用会启动失败——typecheck + 启动验证兜底
