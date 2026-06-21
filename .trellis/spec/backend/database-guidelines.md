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

## Naming Conventions

- 表名:snake_case 复数(`api_keys`, `global_providers`)或 Better Auth 约定的单数(`user`, `session`)。
- 列名:snake_case(`created_at`, `user_id`)。
- 索引:`{表}_{字段}_idx`;唯一索引:`{表}_{字段}_unique_idx`。

## Common Mistakes

- **不要静态 import pg 或 better-sqlite3 顶层驱动** —— 会被 Turbopack 打进 Edge instrumentation 编译(`util/types` 解析失败)。用动态 `await import("pg")`。
- **不要在 instrumentation.ts import 业务模块** —— 会触发 Edge 编译。仅做轻量日志。
- **双 schema 改一处忘改另一处** —— 加列必须同时改 pg.ts 和 sqlite.ts。
- **密钥明文入库** —— provider key 必须经 `crypto.encrypt()`(AES-GCM);sk 只存 `hashSecret()` 的 sha256。
