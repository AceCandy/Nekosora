# Database Guidelines

> Database patterns and conventions for Nekusora.

---

## Overview

- **ORM**: Drizzle ORM,**仅 PostgreSQL**(+pgvector)。
- **连接工厂**:`src/lib/infra/db/index.ts` 导出 `getDb / getSchema / closeDb`,惰性初始化 pg 池(`max` 由 `DB_POOL_MAX` 配置,缺省 20;主进程 Next.js 与 worker 各持独立 pool,总连接 = 各进程 max 之和,须低于 PG `max_connections` 余量)。业务代码统一 `import { getDb, getSchema, closeDb } from "@/lib/infra/db"`,**禁止**直接 import schema 或驱动模块。
- **Schema 单份**:`src/db/schema/pg.ts`(pg-core)。Better Auth 表由 `src/db/auth-schema.ts`(dialect 中立描述)在 pg.ts 具象化。
- **迁移单份**:`drizzle/pg/`,启动时 `bootstrapDatabase()` 自动 `migrate({ migrationsFolder: "drizzle/pg" })`。
- 已移除 SQLite / better-sqlite3 / sqlite-vec 双 dialect 回退(2026-07 收敛)。不再有 `isPg` / `dbDialect` / `DB_DIALECT` / `SQLITE_PATH`。

## Dynamic Import(关键约束)

- **`getDb` / `bootstrap` / `queue` 必须用动态 import 加载 pg / pg-boss 驱动**,不能用静态 `import`。
- 原因:Next 15 把 `instrumentation.ts` 同时编译成 Node 与 Edge 版本。静态 import 会让 Turbopack 在 Edge 编译时把 `pg` → `util/types` 拉入,Edge runtime 不存在 → 编译失败。
- 模式:函数内 `const { drizzle } = await import("drizzle-orm/node-postgres"); const { default: pg } = await import("pg");`。queue 用变量路径 `const m = "pg-boss"; await import(m)` 进一步阻断静态分析。
- `pnpm build` 的 Edge instrumentation 编译是这条约束的验证 gate。

## Query Patterns

- `getDb()` 返回 `any`(drizzle 跨表联合时 query builder 类型不互通,弱化类型换取可调用性)。业务通过 schema 表引用驱动查询。
- `getSchema()` 同步访问已加载 schema(必须先 `await getDb()`)。
- 查询用 drizzle 的 `eq/and/inArray/gte/lte/desc` 等。大小写不敏感 LIKE 用 `ilike`(pg)。
- 向量检索用 pgvector `<=>` 余弦距离算子,`distanceToSimilarity(d) = 1 - d/2` 还原相似度 [0,1]。

## Transactions

- PostgreSQL Drizzle transaction callback 可 `async`:`await db.transaction(async (tx) => { ... await tx.update(...)... })`。
- 无需分支 dialect(已 pg-only)。

## Migrations

- `pnpm db:generate:pg` 生成 → 启动时自动 `migrate`(或 `pnpm db:migrate:pg` 手动)。
- pg-boss 的表在独立 `pgboss` schema,与 Drizzle 的 `public` schema 不冲突,**无需协调迁移**。
- pgvector 的 HNSW 索引 drizzle 暂无声明式 API,迁移后手动加 SQL。

### Scenario: Startup Drizzle Migrate(PG)

#### 1. Scope / Trigger
- `bootstrapDatabase()` 启动时跑 Drizzle `migrate()`,消费 `drizzle/pg/*.sql`。
- 修改迁移 SQL、`meta/_journal.json`，或应用可能多进程并发启动时，必须遵守本场景。
- DB 连不上 / 建表失败 / 管理员创建失败 → throw 阻断启动。

#### 2. Signatures
- `runMigrations(db)`：从 `db.$client` 取得专用 `PoolClient`，持锁完成协调与迁移。
- `migrate(db, { migrationsFolder: "drizzle/pg" })`
- `pg_advisory_lock(hashtext(current_database()), hashtext('drizzle.__drizzle_migrations'))`
- 迁移产物:`drizzle/pg/0000_*.sql`、`meta/_journal.json`、`meta/0000_snapshot.json`。

#### 3. Contracts
- `drizzle/pg/meta/**` 必须与 SQL 文件一起提交;`.gitignore` 不得忽略 `meta`。
- **已发布并可能在任一数据库执行过的 SQL、journal `when/tag/idx` 均不可改写**；结构变更必须追加新迁移。
- PG baseline enum 用 `DO ... EXCEPTION WHEN duplicate_object` 幂等。
- 全部 PG 表/enum 存在但 `drizzle.__drizzle_migrations` 为空 → 启动补基线记录后继续。
- 只有 enum 残留 → 继续幂等建表。
- 部分表存在 → throw 明确的 partial-schema 错误(不猜测)。
- 历史 journal 时间漂移只允许协调“相同 SQL hash 已按旧时间登记”的单一安全场景：前序 canonical 时间完整、目标时间未占用、没有后续或未知记录；`0000` 的历史 hash 只能通过代码中的显式白名单兼容。
- advisory lock、协调事务和官方 migrator 必须共用同一条连接；协调事务内对迁移账本加 `SHARE ROW EXCLUSIVE` 表锁。
- 协调 UPDATE 必须同时匹配 `id/hash/旧时间`、确认目标时间空闲，并严格要求 `rowCount === 1`；否则回滚并阻断启动。
- 解锁失败时销毁连接，不能把可能仍持锁的连接归还连接池。
- 连通性探测:`db.execute(sql\`select 1\`)`。

#### 4. Validation & Error Matrix
- 缺 `meta/_journal.json` → migrate throw `Can't find meta/_journal.json file`。
- journal 时间非严格递增、hash 重复或值非法 → 协调事务回滚并阻断启动。
- canonical 时间上的 hash 不匹配当前迁移且不在 `0000` 白名单 → 阻断启动。
- 相同 hash 位于旧时间且完整连续前缀可证明 → 条件修正 `created_at`，再由官方 migrator 执行尾部迁移。
- 前序缺失、后续提前登记、未知记录、重复 id/hash/时间或目标时间冲突 → 不 UPDATE、不调用 migrator。
- 条件 UPDATE 未命中或无明确 `rowCount` → 视为并发变化，回滚并阻断启动。
- advisory lock 获取/释放失败 → 阻断启动；无法确认解锁时销毁连接。
- 全表存在无 Drizzle 记录 → 补基线记录后 migrate 继续。
- 部分表存在无记录 → throw partial-schema 错误,需重置或 `BOOTSTRAP_SKIP_MIGRATE=1`。

#### 5. Good / Base / Bad Cases
- Good: SQL + `_journal.json` + snapshot 一起生成并提交。
- Good: 已发布迁移需要调整时追加下一个迁移，不修改旧 SQL 或旧 journal entry。
- Base: 空账本或正常连续前缀不产生协调 UPDATE，直接进入官方 migrator。
- Base: 已核实的同 hash 旧时间记录只修正账本时间，不重跑该 SQL。
- Bad: 只提交 `0000_*.sql`,忽略 `meta/**`。
- Bad: 把 partial schema 标记为已迁移。
- Bad: 为整理编号、文件名或时间线而改写已发布 journal 的 `when/tag/idx`。
- Bad: 在 Pool 上先拿 advisory lock，再调用可能切换连接的 migrator。

#### 6. Tests Required
- PG 迁移单测:complete-existing-schema adoption + partial-schema rejection(见 `src/lib/infra/db/bootstrap.test.ts`)。
- 协调单测:安全重定时、连续前缀/空账本、journal 与 ledger 重复、断层、未知记录、baseline 白名单、UPDATE `rowCount`。
- 连接生命周期单测:锁获取失败、migrate 失败、unlock 返回 false/抛错，断言 unlock 与 `release(destroy)`。
- 断言点:`insert/update drizzle.__drizzle_migrations`、表锁与 advisory lock 顺序、错误路径不调用 migrator。
- 真实启动验证:启动日志只协调目标 hash，尾部迁移新增账本记录，目标 schema 对象存在，健康检查通过，调试服务关闭。

#### 7. Wrong vs Correct
Wrong:
```gitignore
/drizzle/pg/meta
```
Wrong:
```json
{"idx": 9, "when": 1784988074784, "tag": "renamed_existing_migration"}
```
Correct:
```text
drizzle/pg/0000_*.sql
drizzle/pg/meta/_journal.json
drizzle/pg/meta/0000_snapshot.json
```
Correct:
```json
{"idx": 10, "when": 1785003843594, "tag": "new_follow_up_migration"}
```

## Timestamps(时区)

- **PG 时间戳必须用 `timestamp({ withTimezone: true })`**(timestamptz)。`timestamp`(without tz)+ 非 UTC 服务器 → epoch 偏移,破坏时间筛选。
- 前端展示固定 `timeZone: "Asia/Shanghai"`(`formatDateTimeLocal`),SSR/client 一致防 hydration。

## Naming Conventions

- 表名:snake_case 复数(`api_keys`)或 Better Auth 约定单数(`user`, `session`)。
- 列名:snake_case(`created_at`, `user_id`)。
- 索引:`{表}_{字段}_idx`;唯一索引:`{表}_{字段}_unique_idx`。

## Model Catalog

- `model_catalog` 是模型类型、能力和默认参数的唯一事实来源;`models.catalog_id` 用 `ON DELETE RESTRICT` 引用。
- `models` 不保存 `vendor` 或能力 JSON 副本;需要能力时 join `model_catalog`。
- 创建模型显式目录选择优先,否则按规范化标准名与显式 aliases 精确匹配。
- 目录数据变更必须提供 PG 迁移(不再有 SQLite 等价迁移)。

## Testing(mock 向量检索)

- recall/extract 单测 mock `@/lib/infra/db` 的 `execute`:pg `<=>` 路径在 mock 下,返回 `distance = 2*(1-cos)`,使 `distanceToSimilarity(d)=1-d/2` 还原为原始余弦 `cos`(对齐 `cosineSimilarity` 返回 cos 的语义)。
- mock execute 需解析 sql 模板的 `strings`+`values` 重组文本,提取 query embedding(`"[...]"`)、scope、LIMIT,在内存算余弦排序。
- DELETE 路径(project 过期清理)mock 直接操作 store。

## Common Mistakes

- **不要静态 import pg / pg-boss 顶层驱动** —— Turbopack 会打进 Edge instrumentation(`util/types` 解析失败)。用动态 `await import`。
- **不要在 instrumentation.ts 静态 import 业务模块** —— 触发 Edge 编译。用变量路径 `const p = "@/lib/infra/db/bootstrap"; await import(p)`。
- **删除 dialect 限制 guard 时,判断是删条件还是删整个 guard** —— `if (cond && !isPg)` 这类 guard 的存在意义是「sqlite 模式禁用某能力」;sqlite 删除后整个 guard 无意义,应**整体删除**,而非改成 `if (cond)`(那会变成「所有模式禁用」,造成功能回归)。本次 `registry.ts` stdio guard 照字面删 `!isPg` 导致 stdio MCP 全禁,trellis-check 独立复核捕获。
- **密钥明文入库** —— provider key 必须经 `crypto.encrypt()`(AES-GCM);sk 只存 `hashSecret()` 的 sha256。
- **幂等数据补种** —— 存量行派生到新表用 `INSERT ... SELECT ... WHERE NOT EXISTS`(按业务键判重),不要用 `ON CONFLICT`(新表无唯一约束时不可用)。
