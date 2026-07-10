# Design: 统一资源模型(providers/models/routes + 可见性)

> 技术设计。数据契约、改造点、边界决策。基于 `research/refs-map.md`(23 条数据层改造点)+ `research/ui-map.md`(20 条 UI 改造点)。

## 1. 设计总则

把六张镜像表合并成三张统一表,用 `ownerUserId` 表达归属、`models.visibility` 表达是否共享。**核心算法不动,只动数据来源**——网关的 orderRoutes/weightedShuffle/熔断/pickWeightedKey/parseKeyBundle 全部保留。

**关键有利条件**:项目未上线,无历史包袱。schema 走破坏性变更(drop 旧六表 + create 新三表),不写任何数据搬迁/兼容逻辑。

## 1.5 计费与可见性原则(已与用户确认)

- **用量统计/计费 = 调用者**:`usageLogs.userId` + 调用者 apiKey。B 调 A 的 public 模型,用量记 B。**现状已满足,usage_logs 不动**。
- **上游 API 成本 = provider owner**:调真实上游用 provider 配置的 key,成本归 provider owner。public 模型挂的是 admin(平台)的 provider → 平台出上游成本。这是「admin = 平台」的体现。
- **可见性分层**:`visibility` 只存在于 `models`。`providers` 不公开(全 per-user private)。

## 2. 数据模型(新三表 + keyModelBindings)

> 双方言(`src/db/schema/sqlite.ts` + `pg.ts`)同构定义。

### 2.1 `providers`(合并 global_providers + user_providers)—— 不公开

> providers **没有 visibility 字段**,全部 per-user owner 隔离,只有 owner 自己能看到/管理。普通用户配路由只能从自己的 provider 里选。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text pk | uuid |
| **ownerUserId** | text →user.id notNull cascade | 创建者 |
| name | text notNull | |
| protocol | text notNull | openai/anthropic/gemini/openai-compatible |
| baseUrl | text notNull | |
| apiKeysEnc | text notNull | **统一列名**(消除 apiKeysEnc/apiKeyEnc 差异)。加密多 key bundle |
| keyStrategy | text notNull default "round_robin" | **统一**(原 user 表无此列,补齐) |
| enabled | bool notNull default true | |
| priority | int notNull default 0 | |
| connectTimeoutMs / readTimeoutMs / streamIdleTimeoutMs | int nullable | 原 user 表无,补齐(可选填) |
| headersJson | json nullable | |
| lastHealthCheckedAt / lastHealthyKeyCount / lastTotalKeyCount | | 健康检测回写 |
| createdAt / updatedAt | timestamp notNull | |

- 唯一约束:`unique(ownerUserId, name)`;索引:`ownerUserId`
- **可见性**:后台管理仅 owner 可见(查询带 `where ownerUserId`)。运行时被路由引用时不限 owner(public 模型的 routes 可 join 到 owner 的 provider)。

### 2.2 `models`(合并 global_models + user_models)—— 有 visibility

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text pk | |
| **ownerUserId** | text →user.id notNull cascade | 创建者 |
| **visibility** | text notNull default "private" | "public" \| "private"。仅 admin 可设 public |
| name | text notNull | 对外模型名 |
| displayName | text | |
| vendor / icon | text nullable | |
| capabilities | json notNull default {} | |
| systemPrompt / description | text nullable | |
| enabled | bool notNull default true | |
| sortOrder | int notNull default 0 | |
| createdAt / updatedAt | timestamp notNull | |

- 唯一约束:`unique(ownerUserId, name)`(per-owner)。public 模型 name 全局唯一由**应用层**在发布时校验。
- **砍掉 `accessScope`/`internal`**:原 global_models.accessScope 不保留。系统任务(compact/orchestrator)改读 `visibility=public && enabled`(§8)。
- **砍掉遗留列** `user_models.providerId`/`upstreamModelName`。

### 2.3 `routes`(合并 global_routes + user_routes)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text pk | |
| **ownerUserId** | text →user.id notNull cascade | 跟随所属 model owner |
| **modelId** | text →models.id notNull cascade | **统一列名**(原 user 用 userModelId) |
| providerId | text →providers.id notNull cascade | |
| upstreamModelName | text notNull | |
| priority / weight | int notNull default 0/1 | |
| enabled | bool notNull default true | |
| headersJson | json nullable | |
| createdAt | timestamp notNull | |

- 索引:`modelId`、`ownerUserId`

### 2.4 `key_model_bindings`(收敛)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text pk | |
| keyId | text →apiKeys.id notNull cascade | |
| **modelId** | text →models.id notNull cascade | **收敛**:原 scope+globalModelId+userModelId → 单 modelId |
| createdAt | timestamp notNull | |

- 唯一约束:`unique(keyId, modelId)`

## 3. 可见性规则(四套场景)

| 场景 | 规则 |
|---|---|
| **网关 API(`/v1/*`)** | 只 `ownerUserId = 请求者`(子 key 则 owner = key 所属用户)。**public 对网关不可见**。用户诉求:网关只能调自己创建的模型。 |
| **WebChat 选择器** | `visibility=public` ∪ `(private && owner=自己)`,排序 **private 在前**(用户诉求:chat 优先展示个人)。 |
| **后台管理(models/routes)** | admin:`public` ∪ `(private && owner=自己)`;user:仅 `(private && owner=自己)`(后台不显示 public)。 |
| **后台管理(providers)** | 仅 owner 自己(无 public 概念)。 |

> 这是与现状最大的语义变化:网关 owner-only(原来 public 对网关可见)、后台分层可见。

## 4. 权限矩阵

| 操作 | public model/route | private model/route | providers(恒 private) |
|---|---|---|---|
| 创建 | 仅 `role=admin` | admin + user | admin + user |
| 后台读取 | 仅 admin | 仅 owner | 仅 owner |
| 消费读取(网关) | —(网关不可见) | 仅 owner | (被路由引用,不限 owner) |
| 消费读取(chat) | 所有人 | 仅 owner | — |
| 更新 | 任意 admin | 仅 owner | 仅 owner |
| 删除 | 任意 admin | 仅 owner | 仅 owner |
| 发布(private→public) | — | owner 且 admin | —(不适用) |

- 每个 server action 先 `requireSession()`,再按 `role` + `ownerUserId` + `visibility` 校验。`reorderXxx` 全表 sortOrder 重写必须带 `where(ownerUserId)`(per-owner 隔离,沿用 `list-drag-sort` spec)。

## 5. 网关路由解析统一(核心,低风险)

### 5.1 `route-repository.ts`:6 方法 → 3 方法

```
findEnabledGlobalModel(name) + findEnabledUserModel(name, userId)
  → findEnabledModelById(modelId):
     where id=? && enabled → 单条(无歧义)。可见性校验在上层 resolveRoutes 按 ctx.source 做。

findEnabledModelByNameForOwner(name, userId):
     where name=? && ownerUserId=userId && enabled   // 网关用(owner-only)

findEnabledGlobalRoutes(modelId) + findEnabledUserRoutes(userModelId)
  → findEnabledRoutes(modelId):
     routes join providers where routes.modelId=? && routes.enabled && providers.enabled
     orderBy(priority asc)

findEnabledUserProvider(providerId) → findEnabledProvider(providerId)

findKeyModelBindings(keyId): {globalModelIds, userModelIds} → {modelIds: Set<string>}
```

### 5.2 `routing.ts` —— 按 `ctx.source` 分流

- `resolveRoutes(ctx, modelName)`:网关路径(**by name,owner-only**)。
  - `findEnabledModelByNameForOwner(name, ctx.userId)` → model。命中 null → model_not_found。
  - 子 key 绑定校验用合并后 `allowedModelIds`。
  - 删 accessScope=internal 拒绝分支(L79-81)。
- **WebChat 路径(by modelId,无重名歧义)**:WebChat 选项已带 `modelId`,发消息传 modelId 而非 name。新增 `resolveRoutesById(ctx, modelId)`:
  - `findEnabledModelById(modelId)` → 校验可见性:`visibility=public` 或 `ownerUserId=ctx.userId`,否则 model_not_found。
  - 复用 `resolveModelRoutes(model)`。
- `resolveGlobalRoutes`(L106)+ `resolveByoRoute`(L145) → 合并为 `resolveModelRoutes(model)`,路径唯一,`toResolvedProvider` 不传 keyField。
- `toResolvedProvider`(L36-49):**去掉 keyField**,固定读 `apiKeysEnc`。
- `listModelsByCapability`(L271):双查 → 单查 models(visibility 规则),返回 `source` 语义见 §10.2。

**核心算法不动**:`orderRoutes`/`weightedShuffle`/`filterByCircuitBreaker`/`pickWeightedKey`/`parseKeyBundle` 原样保留。

### 5.3 `ResolvedRoute` 类型(`src/lib/providers/types.ts`)

- `globalModelId`/`userModelId` → 单 `modelId`。
- `source: "global"|"byo"` 保留,语义改为基于 visibility(`public→"global"`、`private→"byo"`),供 usage 日志/前端 badge 复用。

## 6. 迁移策略(保数据搬迁)

> 修订:用户要保留开发库数据(不重配),故迁移含数据搬迁,非纯 DDL。

- schema 删除旧六表 + 旧 keyModelBindings,新增 providers/models/routes + 新 keyModelBindings。
- 双方言迁移(`drizzle/pg/0010_unify_resource_model.sql` + `drizzle/sqlite/0008_unify_resource_model.sql`):CREATE 新表 → `INSERT...SELECT` 搬迁旧表数据(保留旧 id 避免外键断裂;`global_*`→owner=admin/visibility=public;`user_*`→owner=userId/visibility=private;`key_model_bindings` 用 `COALESCE(global_model_id, user_model_id)` 收敛为单 modelId)→ DROP 旧表/旧 enum → RENAME 临时表 `key_model_bindings_new`→`key_model_bindings`。**含数据搬迁**。
- `bootstrap.ts` 的 `PG_BASELINE_TABLES`/`PG_BASELINE_TYPES` 更新(删 global_*/user_*/access_scope/binding_scope,加 providers/models/routes/model_visibility)。
- `parseKeyBundle` 向后兼容裸字符串/单 key,`user_providers.apiKeyEnc` 直接搬到 `providers.apiKeysEnc` 运行时能解析,无需格式转换。
- snapshot 由脚本生成(`0010_snapshot.json`/`0008_snapshot.json` 反映新 schema,避免后续 generate 重复 diff)。
- dev 库已 migrate 验证:5 providers/5 models(3 public+2 private)/5 routes,旧六表已 drop,数据完整保留。

## 7. service / actions 合并

- `panel/actions.ts` 与 `admin/actions.ts` 的 provider/model/route CRUD 合并为统一一套(操作 providers/models/routes),按 `ownerUserId` + `visibility` + `role` 过滤/校验。
- `createProvider`:所有用户均可,providers 无 public。普通用户建 provider 即自己的。
- `createModel`:普通用户强制 `visibility=private`;admin 可选 public。
- `reorderModels`/`reorderModels`:事务内 sortOrder 重写带 `where(ownerUserId)`。
- `listModels`/`getMyModels`:按 §3 后台可见性查询(admin 含 public,user 仅自己 private)。
- `getBindableModels`(panel/actions.ts:386)→ 单查 models(自己 private,供子 key 绑定;网关 owner-only 语义下子 key 绑定的是 owner 自己的模型)。

## 8. 绕过 service 的 7 处只读点(全部改读统一表)

| 文件:行 | 改动 |
|---|---|
| `src/lib/rag/embedding.ts:57` | 读 providers(by id) |
| `src/app/(dash)/admin/settings/ModelConfigSection.tsx:41-45` | 读 providers(列 enabled,按 owner) |
| `src/features/chat/actions/conversations.ts:15-51` | getVisibleModels/getImageModels → 单查(§9) |
| `src/app/v1/models/route.ts:48-72` | GET /v1/models → 单查 models(**owner-only**,网关语义) |
| `src/app/v1/mcp/route.ts:131-133` | list_models → 单查 models(owner-only) |
| `src/lib/chat/orchestrator.ts:105-109` | vision 能力校验 → 读 models(by id/name) |
| `src/lib/compact/service.ts:219-225` | 摘要模型 → 读 `visibility=public && enabled`(原 internal 优先→public) |

## 9. chat 消费改造(双查询 → 单查询)

- `getVisibleModels`(conversations.ts:12):返回值 `{globals, byos}` → 扁平 `models[]`,where `(public || (private&&owner)) && enabled`,orderBy **private 在前**(如 `visibility asc` + sortOrder;private 排前需明确排序)。
- `getImageModels`:同样单查 + imageGeneration 过滤。
- **WebChat 传 modelId**:`ModelOption` 以 `modelId` 为选项 id;ChatComposer/发消息链路传 modelId(不再传 name),后端走 `resolveRoutesById`。避免 public/private 同名歧义。
- `ModelOption.source`(types.ts:53):基于 visibility 推导(badge 标 public)。
- `ChatToolbar`(L122-127):badge 判定改 `visibility==="public"`。

## 10. 边界决策

### 10.1 重名消解
- **网关**:owner-only + `unique(ownerUserId, name)` → owner 内无重名,网关 by name 无歧义。
- **WebChat**:改传 modelId(§9),UI 同名显示为两个选项(public 带 badge、private 不带),排序 private 在前。用户选哪个调哪个,无歧义。
- public 模型 name 全局唯一:应用层在发布(public)时校验,避免两个 admin 建同名 public。

### 10.2 `source` 语义
保留 `source: "global"|"byo"`,语义从「哪张表」改为「模型 visibility」:`public→"global"`、`private→"byo"`。避免大面积重命名 i18n/类型。

### 10.3 砍掉 accessScope/internal
原 internal(系统任务专用)语义砍掉。compact/orchestrator 改读 public 模型。未上线,无影响。

## 11. UI / 路由改造

### 11.1 鉴权与路径
- **资源管理页**(models/providers/templates/usage)统一到 `/panel/*`,走 `requireSession`,页面内按 `role` 显隐「发布」能力。
- **纯系统管理页**(output-modes/render-styles/users/operations/settings/概览)**保留 `/admin/*` + requireAdmin**(用户确认:先保留,后续再考虑迁移)。
- `src/app/(dash)/layout.tsx:27-38` 分流逻辑保留(`/admin`→requireAdmin;/panel→requireSession),`nav-config.ts` 把资源项并入 `myConfigGroup`(admin 可见发布),`globalManagementGroup` 仅留系统管理项。

### 11.2 Manager 组件去 variant
- `ModelsManager`(L109-111):去 `variant: "global"|"byo"`。`accessScope` 列 → `visibility` 列(admin 可见;普通用户恒 private 可不显示)。`ModelFormDialog` 两套 initial → 一套 + admin 可见的 `visibility` 选择器(发布开关)。删警告文案二分。
- `ProvidersManager`:去两 page.tsx 列名差异(`apiKeysEnc` 统一)、PROTOCOLS 抽共享去重。
- `ProviderFormDialog`:补 `keyStrategy` 选择器(原 admin 硬编码 round_robin)。
- `RouteFormDialog`:外键名 `userModelId`→`modelId`。

### 11.3 i18n
`messages/{zh-CN,en}.json`:`addGlobalModel/addByoModel`→`addModel`;`deleteGlobalWarning/deleteByoWarning`→统一;`scopePublic/scopeInternal`→`visibilityPublic/visibilityPrivate`;`nav.globalProviders/globalModels` 并入。两份同步。

## 12. 测试策略

- **网关等价性**:`setRouteRepository` 注入 mock,验证 `resolveRoutes`(网关 owner-only)+ `resolveRoutesById`(webchat)在合并前后路由链等价(priority/weight/source)。新增 repo 统一方法单测。
- **可见性/权限**:单测覆盖 admin/user × public/private × 各场景(网关/chat/后台)的过滤与拒绝。
- **smoke**:`scripts/smoke/routing.smoke.ts` 改操作统一表。
- 质量门槛:`pnpm lint` + `pnpm typecheck` + `pnpm test` 全绿。

## 13. 回滚
未上线 + 破坏性变更,回滚 = git revert(schema+代码+迁移)。迁移是 drop+create,revert 后重新 migrate 即恢复空表。

## 14. 待确认项 —— 已全部清解

1. ~~重名优先级~~ → 消解:网关 owner-only 无歧义;WebChat 改 byId 无歧义(§10.1)。
2. ~~系统管理页路径~~ → 用户确认:保留 `/admin/*`(§11.1)。
3. ~~普通用户 provider 可见性~~ → 用户确认:只用自己 provider,providers 不公开(§2.1)。
4. ~~计费归属~~ → 用户确认:按调用者(usageLogs.userId),现状已满足(§1.5)。

design 已定稿,可进 review → `task.py start`。
