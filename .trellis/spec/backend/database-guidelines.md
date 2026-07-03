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

## Naming Conventions

- 表名:snake_case 复数(`api_keys`, `global_providers`)或 Better Auth 约定的单数(`user`, `session`)。
- 列名:snake_case(`created_at`, `user_id`)。
- 索引:`{表}_{字段}_idx`;唯一索引:`{表}_{字段}_unique_idx`。

## Common Mistakes

- **不要静态 import pg 或 better-sqlite3 顶层驱动** —— 会被 Turbopack 打进 Edge instrumentation 编译(`util/types` 解析失败)。用动态 `await import("pg")`。
- **不要在 instrumentation.ts import 业务模块** —— 会触发 Edge 编译。仅做轻量日志。
- **双 schema 改一处忘改另一处** —— 加列必须同时改 pg.ts 和 sqlite.ts。
- **密钥明文入库** —— provider key 必须经 `crypto.encrypt()`(AES-GCM);sk 只存 `hashSecret()` 的 sha256。
