# Database Guidelines

> Database patterns and conventions for Nekusora.

---

## Overview

- **ORM**: Drizzle ORM,双 dialect(PostgreSQL + SQLite)。
- **降级**:`DB_DIALECT=pg` 用 Postgres(+pgvector);否则 SQLite(+sqlite-vec)。`src/lib/infra/db/index.ts` 工厂切换。
- **两份 schema 必须同构**:`src/db/schema/pg.ts`(pg-core)与 `sqlite.ts`(sqlite-core)表名、字段语义一致,仅列类型不同。

## Query Patterns

- 业务代码统一 `import { getDb, getSchema } from "@/lib/infra/db"`,**禁止**直接 import 具体 dialect 模块。
- `getDb()` 返回 `any`(dual-dialect 的 query builder 类型不互通,弱化类型换取可调用性)。
- `getSchema()` 同步访问已加载 schema(必须先 `await getDb()`)。
- 查询用 drizzle 的 `eq/and/inArray` 等,跨 dialect 通用。

## Transactions

- PostgreSQL Drizzle transaction callbacks may be `async`; better-sqlite3 transaction callbacks must be synchronous. Returning a Promise from SQLite throws `Transaction function cannot return a promise` after any synchronous statements have already run.
- A dual-dialect write action must not unconditionally use `await db.transaction(async (tx) => ...)`. For a multi-statement atomic write, branch on `isPg`: use awaited query builders in the PostgreSQL transaction and synchronous `.run()` calls in the SQLite transaction.

## Migrations

- PG:`pnpm db:generate:pg` 生成 → `pnpm db:migrate:pg` 应用。
- SQLite:`pnpm db:push:sqlite`(单文件库用 push 更省心)。
- pg-boss 的表在独立 `pgboss` schema,与 Drizzle 的 `public` schema 不冲突,**无需协调迁移**。
- pgvector 的 HNSW 索引 drizzle 暂无声明式 API,迁移后手动加 SQL。

### Scenario: Startup Drizzle Migrate Artifacts

#### 1. Scope / Trigger
- Trigger: `bootstrapDatabase()` runs Drizzle `migrate()` during process startup for both PostgreSQL and SQLite.
- Any generated migration baseline used by startup is an infra contract, not a local-only artifact.

#### 2. Signatures
- PostgreSQL startup migrate: `migrate(db, { migrationsFolder: "drizzle/pg" })`.
- SQLite startup migrate: `migrate(db, { migrationsFolder: "drizzle/sqlite" })`.
- Migration artifact shape per dialect: `0000_*.sql`, `meta/_journal.json`, `meta/0000_snapshot.json`.

#### 3. Contracts
- `drizzle/pg/meta/**` and `drizzle/sqlite/meta/**` must be committed with the matching SQL files.
- `.gitignore` must not ignore Drizzle `meta` directories; otherwise a fresh checkout fails before tables are created.
- PG baseline enum creation should tolerate duplicate enum types with `DO ... EXCEPTION WHEN duplicate_object`.
- If all PG baseline tables/enums exist but `drizzle.__drizzle_migrations` is empty, startup may adopt the baseline by inserting the local baseline migration record.
- If only PG enum types exist, startup should continue; the baseline type creation is idempotent.
- If only part of the PG baseline tables exists, startup must stop with a clear partial-schema error instead of guessing.
- Startup connection probes are dialect-specific:
  - PostgreSQL Drizzle instance uses `db.execute(sql\`select 1\`)`.
  - better-sqlite3 Drizzle instance uses `db.run(sql\`select 1\`)`.

#### 4. Validation & Error Matrix
- Missing `meta/_journal.json` -> startup migrate throws `Can't find meta/_journal.json file`.
- SQL file exists but journal tag differs from the filename -> migrate may skip or apply the wrong migration sequence.
- SQLite probe uses `db.execute` -> startup throws `db.execute is not a function`.
- Full PG schema exists without a Drizzle record -> startup inserts the baseline record, then lets Drizzle migrate continue.
- Enum-only PG residue without a Drizzle record -> startup continues and Drizzle creates the missing tables.
- Partial PG tables exist without a Drizzle record -> startup throws a partial-schema error and requires reset or `BOOTSTRAP_SKIP_MIGRATE=1`.

#### 5. Good / Base / Bad Cases
- Good: SQL, `_journal.json`, and snapshot are regenerated together and committed.
- Base: `pnpm exec drizzle-kit generate --dialect <dialect> --schema <schema> --out <out> --name <name> --breakpoints` produces a matching baseline.
- Bad: committing only `0000_*.sql` while leaving `meta/**` ignored.
- Bad: marking a partial PG schema as migrated; this hides missing tables/constraints until runtime.

#### 6. Tests Required
- Add or keep a bootstrap regression test that runs SQLite startup against a temp database.
- Assertion points: migrator reads `drizzle/sqlite`, admin seeding finishes, and no `meta/_journal.json` or `db.execute` error is thrown.
- Add PG migration unit coverage for complete-existing-schema adoption and partial-schema rejection.

#### 7. Wrong vs Correct

Wrong:

```gitignore
/drizzle/pg/meta
/drizzle/sqlite/meta
```

Correct:

```text
drizzle/pg/0000_*.sql
drizzle/pg/meta/_journal.json
drizzle/pg/meta/0000_snapshot.json
drizzle/sqlite/0000_*.sql
drizzle/sqlite/meta/_journal.json
drizzle/sqlite/meta/0000_snapshot.json
```

### Scenario: 数据迁移补种与 SQLite 列约束变更

#### 1. Scope / Trigger
- Trigger: 迁移需要把存量行的数据派生到新表(如 1:1 关系拆成 1:N 路由),或 SQLite 需要改列约束(NOT NULL → nullable)。

#### 2. Contracts
- **幂等数据补种**:用 `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM <new> WHERE <业务键>)`,而不是 `ON CONFLICT`——当新表没有天然唯一约束可冲突时,`ON CONFLICT` 无法使用。重复执行只补缺失行,不产生重复。
- **SQLite 改列约束**:SQLite 不支持 `ALTER COLUMN ... DROP NOT NULL`。drizzle-kit 生成表重建:`PRAGMA foreign_keys=OFF` → 建 `__new_<table>`(新约束)→ `INSERT INTO __new SELECT *`(全列迁移)→ `DROP <old>` → `RENAME __new TO <old>` → `PRAGMA foreign_keys=ON`。数据/FK/列完整保留。
- 表重建会**丢失原表索引/触发器**(FK 在新表重建);重建后确认索引是否要补回。
- 迁移 SQL 由 `drizzle-kit generate` 生成结构,**数据补种语句需手动追加**(drizzle-kit 不做数据迁移)。

#### 3. Wrong vs Correct
Wrong —— 补种用 `ON CONFLICT DO NOTHING`,但新表无唯一约束:语句报错或判重语义不成立。
Correct —— 补种用 `INSERT ... SELECT ... WHERE NOT EXISTS` 按业务键判重。

Wrong —— 在 SQLite 上手写 `ALTER TABLE ... ALTER COLUMN`:SQLite 不支持,迁移失败。
Correct —— 让 drizzle-kit 生成表重建,校验全列 INSERT 与 FK 重建。

## Timestamps（时区）

- **PG 时间戳必须用 `timestamp({ withTimezone: true })`**（即 `timestamptz`）。`timestamp`（without tz）+ 服务器非 UTC 时区 → DB 存 wall time、pg 驱动按 UTC 解释 → epoch 偏移（东八服务器 +8h），破坏时间筛选与展示。
- **SQLite 用 `integer("...", { mode: "timestamp" })`**（存 epoch，无时区问题）。
- 双 schema 同构：PG `timestamptz` ↔ SQLite `integer timestamp`，语义一致（都存绝对时刻）。
- 前端展示固定 `timeZone: "Asia/Shanghai"`（`formatDateTimeLocal`），SSR/client 一致防 hydration。

## Naming Conventions

- 表名:snake_case 复数(`api_keys`, `global_providers`)或 Better Auth 约定的单数(`user`, `session`)。
- 列名:snake_case(`created_at`, `user_id`)。
- 索引:`{表}_{字段}_idx`;唯一索引:`{表}_{字段}_unique_idx`。

## Model Catalog

- `model_catalog` 是模型类型、能力和默认参数的唯一事实来源；`models.catalog_id` 使用 `ON DELETE RESTRICT` 引用目录。
- `models` 不保存 `vendor` 或能力 JSON 副本。业务查询需要能力时 join `model_catalog`，可以继续向上层 DTO 投影为 `capabilities`。
- 创建模型时显式目录选择优先，否则只按规范化标准名与显式 aliases 精确匹配；通用模板不能自动匹配。
- 流式与非流式兼容性属于具体 route 的探测结果，不进入模型目录。

## Common Mistakes

- **不要静态 import pg 或 better-sqlite3 顶层驱动** —— 会被 Turbopack 打进 Edge instrumentation 编译(`util/types` 解析失败)。用动态 `await import("pg")`。
- **不要在 instrumentation.ts import 业务模块** —— 会触发 Edge 编译。仅做轻量日志。
- **双 schema 改一处忘改另一处** —— 加列必须同时改 pg.ts 和 sqlite.ts。
- **密钥明文入库** —— provider key 必须经 `crypto.encrypt()`(AES-GCM);sk 只存 `hashSecret()` 的 sha256。
