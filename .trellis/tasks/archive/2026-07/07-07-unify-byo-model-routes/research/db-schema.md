# Research: DB Schema — 全局模型/路由 vs 个人(BYO)模型/路由

- **Query**: 摸清 models/routes 的存储结构，重点确认个人模型是否独立表、是否 1:1 直挂、加多路由的迁移方案
- **Scope**: internal
- **Date**: 2026-07-07

## 核心结论（先看这条）

个人模型和全局模型是**两套独立表**（不是同一张表加 userId 隔离）。全局走「四表路由器」（models × providers × routes），个人模型当前是 **1:1 直挂**（model 上直接挂 `providerId` + `upstreamModelName`），**完全没有 routes 概念**。个人 provider 也是独立表（`user_providers`），与全局 provider 分离。

## Findings

### 关键文件

| File Path | Description |
|---|---|
| `src/db/schema/pg.ts` | PG 主 schema，业务表全量定义（含全局/BYO） |
| `src/db/schema/sqlite.ts` | SQLite 镜像 schema，与 pg.ts 保持表名/字段语义一致（仅列类型不同） |
| `src/lib/infra/db/bootstrap.ts` | 启动时 `runMigrations` 自动建表（消费 `drizzle/{pg,sqlite}/*.sql`） |
| `drizzle/pg/*.sql`, `drizzle/sqlite/*.sql` | drizzle migrate 产物；新增表/列需生成新的 `0003_*.sql` |

### 全局域：四表路由器（admin 域）

定义在 `pg.ts` 的「全局 Provider / 模型」段落，三张核心表 + 枚举：

**`global_providers`** —— 全局服务商
- 标识/连接：`id`, `name`, `protocol`(enum `provider_protocol`: openai / anthropic / gemini / openai-compatible / openai-images / openai-audio-stt / openai-audio-tts), `baseUrl`
- 密钥：`apiKeysEnc`(AES-GCM 加密的**多 key bundle JSON**，不是单 key), `keyStrategy`(默认 `round_robin`)
- 调度：`enabled`, `priority`, `connectTimeoutMs`/`readTimeoutMs`/`streamIdleTimeoutMs`, `headersJson`
- 健康：`lastHealthCheckedAt`/`lastHealthyKeyCount`/`lastTotalKeyCount`
- 时间戳：`createdAt`/`updatedAt`

**`global_models`** —— 全局对外逻辑模型
- `id`, `name`(对外模型名，**唯一约束**，调用方传的就是它), `displayName`, `vendor`, `icon`
- `capabilities`(jsonb `ModelCapabilities`), `systemPrompt`, `description`
- `accessScope`(enum `access_scope`: public / internal；internal 不对网关开放), `enabled`, `sortOrder`
- 时间戳

**`global_routes`** —— 全局路由链（多路由核心）
- `id`, `modelId`(FK→`global_models` cascade), `providerId`(FK→`global_providers` cascade)
- `upstreamModelName`, `priority`(默认 0), `weight`(默认 1), `enabled`, `headersJson`
- `createdAt`，带 `modelId` 上的索引

字段确认：route 含 `modelId/providerId/upstreamModelName/priority/weight/enabled`（+ `headersJson`），model 含 `name/displayName/vendor/accessScope/systemPrompt/description/capabilities/enabled`（+ `icon/sortOrder`）。**全部命中预期。**

### 个人域：BYO（用户私有域）

定义在 `pg.ts` 的「用户 BYO Provider / 模型」段落，两张表：

**`user_providers`** —— 个人服务商
- `id`, `userId`(FK→`user` cascade), `name`, `protocol`, `baseUrl`
- `apiKeyEnc`（AES-GCM 加密；**注意：列名是单数 `apiKeyEnc`，但实际存的是 `encryptKeyBundle(keys)` 产出的多 key bundle**——已支持多 key，与 admin 写入路径一致）
- `enabled`, `lastHealthCheckedAt`/`lastHealthyKeyCount`/`lastTotalKeyCount`, 时间戳
- **与 `global_providers` 的差异**：无 `keyStrategy`、无 `priority`、无三个 timeout 字段、无 `headersJson`。即功能窄于全局 provider。

**`user_models`** —— 个人模型（1:1 直挂，无路由）
- `id`, `userId`(FK→`user` cascade), `providerId`(FK→`user_providers` cascade)
- `name`（用户自定义对外模型名，**非唯一约束**，靠 `userId` 隔离）
- `upstreamModelName`（**直接挂在 model 上**，1:1）
- `capabilities`, `enabled`, `createdAt`
- **关键缺失（相对 global_models）**：无 `displayName/vendor/icon/systemPrompt/description/accessScope/sortOrder`
- **关键缺失（相对 global_routes）**：无 `priority/weight/headersJson`，无任何路由表。`providerId`+`upstreamModelName` 就是它的「单条路由」。

SQLite schema 的 `user_models`/`user_providers` 字段与 PG 完全对齐（仅列类型差异），无独立字段。

### 子 Key 模型绑定（双来源 union）

**`key_model_bindings`** —— `scope`(enum `binding_scope`: global / byo)，`globalModelId`(FK) 与 `userModelId`(FK) 二选一。子 key 通过它绑定到全局或 BYO 模型子集。这是路由解析时做「子 key 绑定校验」的依据。

### 迁移机制（如何加表/列）

- 启动流程 `bootstrapDatabase()` → `runMigrations(db, isPg)` 消费 `drizzle/{pg,sqlite}/*.sql`，**幂等**。
- 现有迁移文件：`0000_*.sql`（基线建表）+ `0001_add_messages_deleted_at.sql` + `0002_rename_custom_protocol.sql`。下一个应是 `0003_*.sql`。
- 新增表/列的流程：改 `pg.ts` + `sqlite.ts`（两份必须同步）→ 跑 drizzle 生成迁移 SQL → bootstrap 自动应用。
- `bootstrap.ts` 内有 `PG_BASELINE_TABLES` 白名单（用于「认领已存在的基线库」兼容逻辑），**加新表无需改这个白名单**（它只用于无迁移记录的旧库认领，不影响新表）。

### 个人模型「加多路由」的存储方案对比

| 方案 | 做法 | 迁移成本 | 风险 | 与现有模式一致性 |
|---|---|---|---|---|
| **A. 新建独立 `user_routes` 表**（推荐） | 镜像 `global_routes`：`id/userId/userModelId(FK→user_models)/providerId(FK→user_providers)/upstreamModelName/priority/weight/enabled/headersJson/createdAt` | 低（1 张新表 + 数据迁移脚本） | 低（不动现有表结构） | **最高**——项目一贯用 `user_*` 独立表隔离个人数据 |
| B. 复用 `global_routes` 加 `userId` | 给 `global_routes` 加 `userId`(null=全局)，`modelId` 改为多态指向 global/user | 高（改全局表 + 所有查询加 userId 过滤） | 高（污染全局表，路由解析每条都要判 scope） | 低（破坏现有 user_* 分离约定） |
| C. 全量合并 `global_*` 与 `user_*` | 给 `global_models/global_routes/global_providers` 都加 `userId`(null=全局)，删 user_* 表 | 极高（重写所有 actions/repository/绑定） | 极高（大面积回归） | 违背现有架构 |

**推荐方案 A**：新建 `user_routes`。理由：
1. 与项目「个人数据走 `user_*` 独立表 + `userId` 隔离」的一贯模式完全一致（`user_providers`/`user_models`/`user_memories`/`user_settings` 都是这模式）。
2. `user_models` 上现有的 `providerId`/`upstreamModelName` 可作为「数据迁移种子」——迁移脚本为每条 `user_models` 生成一条对应的 `user_routes`（priority=0, weight=1, enabled=true），随后这两列可保留为兼容或逐步下线。
3. 不触碰全局表，回归面最小。

迁移风险点（方案 A）：
- **数据迁移**：必须为每条已存在的 `user_models` 补种 1 条 `user_routes`，否则旧个人模型会「无路由」直接报错（`resolveByoRoute` 改后查不到路由会抛 `no_route`）。这是上线必须的前置步骤。
- **双 schema 同步**：`pg.ts` + `sqlite.ts` 都要加表定义，且生成两份迁移 SQL。
- **`user_models.providerId/upstreamModelName` 的去留**：若保留，需约定「以 routes 为准，这两列仅遗留/默认」；若下线，需确认没有其他代码读它们（目前 actions 和 routing 都在读）。

## Caveats / Not Found

- 未发现任何已存在的 `personal_routes` / `user_routes` / `my_routes` 表或定义——BYO 路由确为空白。
- `user_models` 是否需要补 `displayName/systemPrompt/description` 等「对齐全局模型」的字段，取决于产品是否要求个人模型也支持这些（当前调研只见 `name/capabilities`）。这是产品决策，不是存储限制。
