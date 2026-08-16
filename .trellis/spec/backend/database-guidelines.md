# Database Guidelines

> Database patterns and conventions for Nekusora.

---

## Overview

- **ORM**: Drizzle ORM,**仅 PostgreSQL**(+pgvector)。
- **连接工厂**:`src/lib/infra/db/index.ts` 导出 `getDb / getSchema / closeDb`,惰性初始化 pg 池(`max` 由 `DB_POOL_MAX` 配置,缺省 20;主进程 Next.js 与 worker 各持独立 pool,总连接 = 各进程 max 之和,须低于 PG `max_connections` 余量)。业务代码统一 `import { getDb, getSchema, closeDb } from "@/lib/infra/db"`,**禁止**直接 import schema 或驱动模块。
- **Schema 单份**:`src/db/schema/pg.ts`(pg-core)。Better Auth 表由 `src/db/auth-schema.ts`(dialect 中立描述)在 pg.ts 具象化。
- **迁移单份**:`drizzle/pg/`,启动时 `bootstrapDatabase()` 自动 `migrate({ migrationsFolder: "drizzle/pg" })`。
- 已移除 SQLite / better-sqlite3 / sqlite-vec 双 dialect 回退(2026-07 收敛)。不再有 `isPg` / `dbDialect` / `DB_DIALECT` / `SQLITE_PATH`。

## Scenario: Next Instrumentation Runtime Isolation

### 1. Scope / Trigger

- Applies when changing `instrumentation.ts`, Node startup initialization, or imports that reach `pg`, Drizzle migrator, or `process.on`.

### 2. Signatures

- `register(): Promise<void>` is the framework entrypoint.
- `registerNodeInstrumentation(): Promise<void>` owns process guards, environment validation, and database bootstrap.
- `pnpm dev` and `pnpm build` use the default Next 16 Turbopack path; `pnpm build:webpack` is the explicit comparison fallback.

### 3. Contracts

- `instrumentation.ts` must contain only the runtime check and the literal `import("./instrumentation.node")` call.
- Node-only dependencies live in `instrumentation.node.ts`; initialization order is guards, environment validation, then database bootstrap.
- Do not use a variable alias path such as `await import(nodePath)` in the framework entrypoint. Webpack cannot resolve it and emits `Critical dependency`, followed by a runtime `MODULE_NOT_FOUND`.
- Do not import bootstrap dependencies directly from the shared entrypoint. Edge compilation otherwise follows `bootstrap -> pg` and fails on Node built-ins such as `fs`.
- `getDb` and bootstrap internals load `pg` and the Drizzle PostgreSQL driver with literal dynamic imports inside Node-only code. Web externalizes `pg`; `pg-boss` belongs only to Gateway/Worker and must not appear in Web config or dependency output.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| `NEXT_RUNTIME=nodejs` | Install guards, validate env, then complete database bootstrap |
| `NEXT_RUNTIME=edge` | Do not load or execute Node initialization |
| Variable-path import in `instrumentation.ts` | Invalid: Webpack warning and runtime module resolution failure |
| Node dependency reachable from the shared entrypoint | Invalid: Edge compilation may fail on `fs`, `pg-native`, or other Node modules |
| Server-side `module factory is not available` after a schema/dependency graph change | Stop Web, remove only the ignored `apps/web/.next` cache, then cold-start and request `/healthz`; browser cache and Service Worker cleanup do not repair the instrumentation module graph |
| Bootstrap failure | Reject `register()` and block startup |

### 5. Good / Base / Bad Cases

- Good: `instrumentation.ts` conditionally imports `./instrumentation.node`, and `/healthz` returns 200 after a cold development start.
- Base: Edge registration returns without importing Node modules.
- Bad: hiding `@/lib/infra/db/bootstrap` in a string variable; it suppresses static resolution but leaves the emitted bundle unable to load the alias.

### 6. Tests Required

- `src/instrumentation.test.ts` asserts Node initialization order, Edge isolation, and bootstrap suppression after validation failure.
- Cold-start `pnpm dev` and request `/healthz`; startup must have no instrumentation `Critical dependency`, `MODULE_NOT_FOUND`, `fs`, or `pg-native` error.
- After an instrumentation module-factory failure, verify the regenerated `.next/dev` cache with a second cold start; do not treat a successful production build alone as development-cache validation.
- `pnpm build` is the production Edge/Node bundling gate; the instrumentation compile stage must not report those errors.

### 7. Wrong vs Correct

```typescript
// Wrong: Webpack cannot resolve the runtime alias expression.
const nodePath = "@/lib/infra/db/bootstrap";
await import(nodePath);

// Correct: keep the shared entrypoint minimal and use Next's Node-only module pattern.
if (process.env.NEXT_RUNTIME === "nodejs") {
  await import("./instrumentation.node");
}
```

## Queue And Worker Lifecycle

The typed pg-boss catalog, replaceable generation, real-handler drain, generic recovery scheduler, and worker shutdown contract lives in [Queue And Worker Lifecycle](./queue-lifecycle.md). Database-specific title and memory durable-intent contracts remain below.

## Scenario: Conversation Title Durable Outbox

### 1. Scope / Trigger

Apply this contract when changing conversation fallback titles, `conversation-title` producers or workers, queue recovery, or the `conversation_title_jobs` schema. The outbox closes the process-exit gap between the visible fallback write and pg-boss persistence.

### 2. Signatures

- `writeFallbackTitle(userId, conversationId, firstUserMessage, chatModel?, chatModelId?): Promise<ConversationTitleJob | null>`
- `ConversationTitleJob`: `id`, `userId`, `conversationId`, `firstUserMessage`, `fallbackTitle`, optional `chatModel` / `chatModelId`
- `dispatchConversationTitleJob(jobId): Promise<boolean>`
- `processConversationTitleJob(jobId): Promise<JobOutcome>`
- `recoverConversationTitleJobs(): Promise<void>`
- Queue payload: `{ id: string }`
- `conversation_title_jobs`: one row per `conversation_id`, with random `id` as the fencing token and `dispatch_after` as the database-clock claim boundary

### 3. Contracts

- Update the fallback and upsert the complete outbox payload in one transaction. A failed update creates no job; a failed upsert rolls back the fallback.
- Claim only with one conditional `UPDATE ... WHERE id = ? AND dispatch_after <= now() RETURNING ...`, then move `dispatch_after` 15 minutes forward. Queue send success or failure never deletes the row.
- Dispatch sends only `{ id }`; the worker reloads the complete outbox row at execution time before applying the existing preflight/final fencing.
- Delivery is durable at-least-once. The worker checks the current job id before model generation and checks it again in the final short transaction.
- The final transaction locks the owned conversation before reading the current outbox row, updates only the default/current fallback title, and deletes only the matching job id. This lock order matches the producer transaction.
- Success and explicit business no-op delete the matching job. Generation or persistence failure preserves it and rejects the queue callback.
- The domain recovery function performs one stable, database-time-ordered scan of at most 25 rows and isolates per-row send failures. Generic worker runtime owns immediate/60-second/unref/single-flight scheduling and stop-drain.
- pg-boss payloads and logs must not contain the first user message, model context, entity IDs, credentials, provider headers, connection strings, or complete request objects.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Fallback update misses | Return `null`; do not insert outbox |
| Outbox upsert fails | Roll back fallback and reject |
| Job not due or another dispatcher claimed it | Return `false`; do not send |
| Queue send fails or producer exits after claim | Keep row; retry after the claim window |
| Stale job id or completed row | Resolve no-op; do not call the model or delete a newer row |
| User renamed the conversation | Delete only the matching old job; preserve the title |
| Job replaced while the model runs | Final transaction returns no-op; preserve the replacement and current title |
| Model or final persistence fails | Keep matching outbox row and reject for pg-boss retry |

### 5. Good / Base / Bad Cases

- Good: the Web process commits fallback + outbox and exits before queue send; a worker scan later claims and sends the same job.
- Good: an old queue message finishes after a replacement job was written; final fencing prevents both title overwrite and replacement deletion.
- Base: immediate dispatch succeeds, worker writes the title and atomically removes the outbox row.
- Bad: deleting the outbox after `queue.send()` treats transport acceptance as business completion and loses recovery state.
- Bad: validating job id only before the model call lets a replaced job overwrite the title after a slow generation.

### 6. Tests Required

- Migration tests assert SQL, journal, snapshot, primary key, conversation uniqueness, both cascade FKs, and `(dispatch_after, created_at)` index.
- Service tests assert fallback/outbox rollback, payload replacement, preflight and final fencing, user rename no-op, atomic success cleanup, and failure preservation.
- Dispatcher tests assert `{ id }` payload, one winner for concurrent claims, not-due no-op, send failure preservation/reclaim, stable limit 25 scanning, and per-item isolation.
- Processor tests assert missing/stale/manual-rename paths return `noop`, a committed title returns `completed`, and generation/persistence failure rejects while preserving durable intent.
- Route tests assert complete model context enters `writeFallbackTitle` and immediate dispatch uses the returned job id.
- Runtime tests assert all handlers register before any recovery scheduler, schedulers stop in reverse order before queue stop, and cleanup continues after an individual stop failure.

### 7. Wrong vs Correct

```typescript
// Wrong: fallback and queue persistence are unrelated writes with no recovery state.
await updateFallback();
void queue.send("conversation-title", job);

// Correct: commit durable intent first; immediate dispatch is only a latency optimization.
const job = await writeFallbackTitle(userId, conversationId, message, model, modelId);
if (job) void dispatchConversationTitleJob(job.id);
```

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
- Web is the only first-admin seed owner. Gateway and Worker call `bootstrapDatabase({ seedAdmin: false })` so concurrent process startup cannot race Better Auth account creation; they still perform connection checks and migrations.

#### 2. Signatures
- `runMigrations(db)`：从 `db.$client` 取得专用 `PoolClient`，持锁完成协调与迁移。
- `migrate(db, { migrationsFolder: "drizzle/pg" })`
- `pg_advisory_lock(hashtext(current_database()), hashtext('drizzle.__drizzle_migrations'))`
- 迁移产物:`drizzle/pg/0000_*.sql`、`meta/_journal.json`、`meta/0000_snapshot.json`。

#### 3. Contracts
- `drizzle/pg/meta/**` 必须与 SQL 文件一起提交;`.gitignore` 不得忽略 `meta`。
- **已发布并可能在任一数据库执行过的 SQL、journal `when/tag/idx` 均不可改写**；结构变更必须追加新迁移。
- “尚未上线”不等于“没有存量数据库”：压缩开发期迁移前必须盘点本地/测试库账本。需要保留数据时，只能在锁与事务内，将 hash 完整匹配旧迁移全集的账本归并为新基线；不能靠环境名称或记录数量推断已完整执行。
- 旧账本的 `id` 只用于条件更新/删除，不代表 canonical 迁移顺序；验证完整历史时按唯一 `created_at` 排序后逐项匹配已知 hash，兼容历史重定时造成的插入顺序差异。
- PG baseline enum 用 `DO ... EXCEPTION WHEN duplicate_object` 幂等。
- 全部 PG 表/enum 存在但 `drizzle.__drizzle_migrations` 为空 → 启动补基线记录后继续。
- `PG_BASELINE_TABLES` 与 `PG_BASELINE_TYPES` 必须覆盖当前 `0000_snapshot.json` 的完整表和 enum 集合；squash 时同步更新，禁止保留已删除对象或遗漏后续新增对象。
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
- 开发期 squash 后完整旧 hash 集合匹配 → 精确更新首条为新基线 hash/time、删除其余旧记录并校验各自 `rowCount`；任一 hash 缺失/未知、时间重复或行数异常 → 整个事务回滚并阻断启动。
- 单基线必须保留新库启动所需的目录数据；schema-only 生成物缺少 `model_catalog` 数据时，须附带受审目录快照及 SHA-256，不能依赖已有数据库内容。
- 条件 UPDATE 未命中或无明确 `rowCount` → 视为并发变化，回滚并阻断启动。
- advisory lock 获取/释放失败 → 阻断启动；无法确认解锁时销毁连接。
- 全表存在无 Drizzle 记录 → 补基线记录后 migrate 继续。
- 全表存在无 Drizzle 记录但 `runs.lease_expires_at/duration_ms/completed_at` 或
  `tool_calls.status/input_json/output_json/error_json` 任一缺失 → 拒绝收养并报告缺失列。
- 部分表存在无记录 → throw partial-schema 错误,需重置或 `BOOTSTRAP_SKIP_MIGRATE=1`。

#### 5. Good / Base / Bad Cases
- Good: SQL + `_journal.json` + snapshot 一起生成并提交。
- Good: 测试库已执行全部 squash 前迁移，启动在事务内归并账本后由官方 migrator 跳过新基线。
- Good: 已发布迁移需要调整时追加下一个迁移，不修改旧 SQL 或旧 journal entry。
- Base: 空账本或正常连续前缀不产生协调 UPDATE，直接进入官方 migrator。
- Base: 已核实的同 hash 旧时间记录只修正账本时间，不重跑该 SQL。
- Bad: 只提交 `0000_*.sql`,忽略 `meta/**`。
- Bad: 把 partial schema 标记为已迁移。
- Bad: 只按表名判断 schema 完整，忽略关键列缺失后补写基线迁移记录。
- Bad: squash 后沿用旧的 baseline 表/enum 清单，导致完整 schema 被拒绝或缺表 schema 被收养。
- Bad: 为整理编号、文件名或时间线而改写已发布 journal 的 `when/tag/idx`。
- Bad: 因为产品未上线就假定测试库可丢弃，压缩 journal 后让已有完整账本变成未知记录。
- Bad: 在 Pool 上先拿 advisory lock，再调用可能切换连接的 migrator。

#### 6. Tests Required
- PG 迁移单测:complete-existing-schema adoption + partial-table/critical-column rejection
  (见 `src/lib/infra/db/bootstrap.test.ts`)。
- 协调单测:安全重定时、连续前缀/空账本、journal 与 ledger 重复、断层、未知记录、baseline 白名单、UPDATE `rowCount`。
- squash 账本单测:已知旧 baseline hash、完整旧链成功、`id`/时间顺序不同、任一 hash 不匹配、仅旧 baseline、UPDATE/DELETE `rowCount` 异常。
- squash 产物测试:journal 仅一条、root snapshot 与当前 schema 等价、模型目录快照存在且来源 hash 合法。
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

### Scenario: WebChat 活动 Run 租约投影

#### 1. Scope / Trigger

- 修改 `runs` 生命周期、会话 `generating` 查询、Chat 心跳或相关 PostgreSQL 迁移时适用。
- 该状态跨越请求进程、数据库、Server Action 和 Sidebar；必须覆盖并发 run、进程崩溃、多实例启动与滚动升级。

#### 2. Signatures

- `runs.lease_expires_at`: nullable `timestamptz`，数据库默认值 `now() + interval '2 minutes'`。
- `runs_active_conversation_idx`: `(conversation_id, lease_expires_at) WHERE status = 'running'`。
- 活动谓词：`EXISTS (... status = 'running' AND lease_expires_at > now())`。
- `startRunStrict(...) -> Promise<void>`；`heartbeatRun(runId) -> Promise<void>`；`persistChatCompletion(...) -> committed result`。

#### 3. Contracts

- `runs` 是生成活动状态唯一事实源；`conversations.generating` 保留供旧版本回滚，但新 runtime 不得读写。
- 租约创建、续租和活动查询统一使用 PostgreSQL `now()`，不得混用应用服务器时间。
- 新 runtime 显式写入两分钟租约；数据库列默认值同时覆盖滚动升级期间仍由旧 runtime 插入、未携带该列的新 running row。
- 迁移只回填 `status='running' AND lease_expires_at IS NULL` 的行，不全表更新 legacy `conversations.generating`。
- 心跳仅按 `runId + status='running'` 更新当前 run；finalize 也只更新当前 running run。任何请求都不得清理同会话其他 run。
- strict start 使用固定 5 秒等待预算，但失败/超时禁止模型调用；该应用层超时不取消底层 PostgreSQL 查询，迟到 running row 由租约过期收敛。
- heartbeat 不使用应用层超时伪装底层完成；completion coordinator 以原始 Promise 单飞调度，并在 abort/terminal/commit 前停止后续 tick。
- assistant、conversation 时间、可选 memory intent 与 terminal run 必须在 conversation-first 短事务中提交。run 条件更新零行必须抛错并回滚，而不是退化为 best-effort success。
- 会话列表与轻量轮询必须复用同一个相关 `EXISTS` 表达式，避免活动定义漂移。
- 普通 `CREATE INDEX` 可能等待大表锁；执行真实生产迁移前必须评估锁窗口。若改用 `CONCURRENTLY`，须独立设计 Drizzle 事务外迁移流程，不得直接塞入现有事务型 migrator。

#### 4. Validation & Error Matrix

| 条件 | 数据库状态 | 活动投影 |
|---|---|---|
| 新 runtime 插入 running run | 显式 fresh lease | true |
| 滚动升级中的旧 runtime 省略 lease | 数据库默认 fresh lease | true，默认窗口内兼容 |
| 迁移前遗留 running + NULL | 迁移回填 fresh lease | true，窗口到期后 false |
| terminal run，即使 lease 尚未过期 | status 非 running | false |
| running + NULL 或过期 lease | 不满足完整谓词 | false |
| 同会话多个 run，仅一条终结 | 仍有另一条 fresh running row | true |
| 旧 runtime 改写 legacy boolean | `runs` 不变 | 新 runtime 查询结果不受影响 |

#### 5. Good / Base / Bad Cases

- Good：两个实例各自维护不同 run 的租约，任一实例完成只终结自己的行。
- Good：新版本部署时，旧实例省略 lease 的 insert 仍获得数据库默认租约。
- Base：历史终态行允许 `lease_expires_at IS NULL`，无需无意义回填。
- Bad：只检查 `status='running'`，会让崩溃遗留行永久显示活动。
- Bad：启动时全量清零会话布尔值，或在单 run finalize 时覆盖会话布尔值。
- Bad：仅由新应用代码设置 lease 而没有数据库默认值，混合版本期间旧实例会持续插入 NULL。

#### 6. Tests Required

- schema 测试断言 nullable `timestamptz`、数据库默认表达式与部分索引谓词。
- 迁移测试断言 add column、set default、仅回填 running NULL、创建部分索引，且不更新 `conversations.generating`。
- 查询测试断言 conversation 关联、running、`lease_expires_at > now()` 三个条件，并覆盖并发/fresh/expired/null/terminal 真值表。
- lifecycle 测试断言 strict start/heartbeat 使用数据库时间，strict start 失败阻断生成，heartbeat 只匹配 running row。
- coordinator 测试使用未完成 heartbeat Promise 验证单飞，并断言 abort/terminal 后没有新 tick。
- 迁移元数据测试断言 SQL、journal 与 snapshot 链同步；发布前另行记录是否在真实 PostgreSQL 验证以及索引锁风险。

#### 7. Wrong vs Correct

```sql
-- Wrong:状态无过期边界，且单值无法表达并发 run。
UPDATE conversations SET generating = false WHERE id = $1;

-- Correct:从所有仍有效的 run 动态派生。
SELECT EXISTS (
  SELECT 1 FROM runs
  WHERE runs.conversation_id = conversations.id
    AND runs.status = 'running'
    AND runs.lease_expires_at > now()
);
```

## Scenario: Chat Memory Durable Intent

### 1. Scope / Trigger

Apply this contract when changing Chat completion persistence, memory extraction queue payloads, `memory_extraction_jobs`, memory worker handling, or memory recovery scheduling.

### 2. Signatures

- `createMemoryExtractionJob({ runId, userId, conversationId, recentMessages }) -> MemoryExtractionJob | null`.
- `dispatchMemoryExtractionJob(jobId) -> Promise<boolean>`.
- `processMemoryExtractionJob(jobId) -> Promise<JobOutcome>`.
- Database: unique `run_id`, run/conversation/user cascade FKs, JSONB `messages`, and `(dispatch_after, created_at)` recovery index.

### 3. Contracts

- Produce the intent inside `persistChatCompletion`; never enqueue a full memory payload directly from the route.
- Normalize to the last six user/assistant messages, at most 500 characters each. Fewer than two normalized messages is an explicit no-op.
- Queue payload contains only `{ id }`. Queue acceptance never deletes the durable row.
- Claim with one conditional database-time update that moves `dispatch_after` 15 minutes forward. The domain recovery function scans at most 25 due rows in stable order; generic worker runtime owns immediate/60-second/unref/single-flight scheduling and stop-drain.
- Worker reads by intent ID. Missing row returns `noop`; provider/add failure rejects generically and preserves the row; success returns `completed`, while input/rate-limit no-op returns `noop`; both resolved outcomes delete only that ID.
- Delivery is at-least-once. Do not claim cross-system exactly-once; mem0 inference/deduplication only reduces replay effects.
- Web and worker queue payload changes require coordinated deployment. Rollback preserves the table and pending rows.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Completion transaction rolls back | No memory intent exists |
| Queue send fails after claim | Row remains; recover after claim window |
| Worker receives stale/missing ID | Resolve no-op |
| Message snapshot has fewer than two entries | Do not create a row |
| Memory provider/add fails | Reject worker; preserve row |
| Extraction succeeds or is an explicit business no-op | Delete matching row |

### 5. Good / Base / Bad Cases

- Good: Web commits and exits before queue send; recovery later dispatches the same intent ID.
- Base: immediate dispatch succeeds, worker extracts, then deletes the intent.
- Bad: route sends user/conversation/full messages directly to pg-boss after commit.
- Bad: `extractMemories` catches provider failure and returns success, causing pg-boss to acknowledge permanently.

### 6. Tests Required

- Schema/migration assertions for unique run, all cascade FKs, dispatch index, SQL, journal, and snapshot.
- Snapshot tests for role filtering, last-six selection, truncation, and fewer-than-two no-op.
- Dispatcher tests for claim winner, not-due no-op, send failure preservation, limit 25, stable order, and per-item isolation.
- Worker tests for missing-ID `noop`, completed/noop deletion, provider failure preservation, payload `{ id }`, and runtime-owned recovery ordering/stop-drain.
- Completion repository and isolated PostgreSQL tests must prove an intent failure rolls back assistant, conversation time, and run terminal.

### 7. Wrong vs Correct

```typescript
// Wrong: commit-to-queue crash window and oversized queue payload.
await persistAssistant();
await queue.send("memory-extract", { userId, conversationId, recentMessages });

// Correct: durable intent shares the core completion transaction; queue carries only its ID.
const committed = await persistChatCompletion({ ...input, memoryJob });
void dispatchMemoryExtractionJob(memoryJob.id);
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

- **不要用等待行锁前捕获的数据库时间判断租约 freshness** —— PostgreSQL `now()` 固定在事务开始，`statement_timestamp()` 固定在语句开始；条件 UPDATE 等锁期间租约可能已经过期。需要先按 id/token/status `SELECT ... FOR UPDATE`，拿锁后再用新语句的 `statement_timestamp()` 校验并续租，最后提交前再次校验。真实 PostgreSQL 测试必须覆盖“等待跨过 expiry”而不只覆盖 token 被替换。
- **Drizzle pgvector 双重序列化** —— `vector(...)` 列的 `mapToDriverValue` 已对 `number[]` 执行 `JSON.stringify`;insert/update 必须传原始数组。业务层先 `JSON.stringify(vector)` 会产生带额外引号的非法 vector。至少用一次真实 PostgreSQL insert 回归，mock 只能检查入参形状。
- **不要静态 import pg / pg-boss 顶层驱动** —— Turbopack 会打进 Edge instrumentation。使用字面量动态 `await import("pg-boss")`,并在 Next 配置中 externalize。
- **不要在 instrumentation.ts 静态 import 业务模块** —— 触发 Edge 编译。只在 Node runtime 分支使用字面量相对导入 `await import("./instrumentation.node")`。
- **删除 dialect 限制 guard 时,判断是删条件还是删整个 guard** —— `if (cond && !isPg)` 这类 guard 的存在意义是「sqlite 模式禁用某能力」;sqlite 删除后整个 guard 无意义,应**整体删除**,而非改成 `if (cond)`(那会变成「所有模式禁用」,造成功能回归)。本次 `registry.ts` stdio guard 照字面删 `!isPg` 导致 stdio MCP 全禁,trellis-check 独立复核捕获。
- **密钥明文入库** —— provider key 必须经 `crypto.encrypt()`(AES-GCM);sk 只存 `hashSecret()` 的 sha256。
- **幂等数据补种** —— 存量行派生到新表用 `INSERT ... SELECT ... WHERE NOT EXISTS`(按业务键判重),不要用 `ON CONFLICT`(新表无唯一约束时不可用)。
