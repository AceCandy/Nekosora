# Research: 六张镜像表（global/user × providers/models/routes）全量引用地图

- **Query**: 为合并六张镜像表为统一 providers/models/routes（ownerUserId + visibility）摸清全量引用
- **Scope**: internal（只读 rg / Read，未改业务代码）
- **Date**: 2026-07-10
- **基线**: 当前 main 分支磁盘内容（sqlite.ts/pg.ts 与同构服务层）

> 结论速览：六张表的真实「物理外键」引用者只有 3 张表（globalRoutes / userRoutes / userModels 自引 / keyModelBindings）。其余 conversations / messages / runs / toolCalls / usageLogs / opsErrorLogs **均无 FK**，只存快照字符串（modelName / providerRef / routeId 等）。bootstrap **不 seed** 这六张表。下面按 providers / models / routes 三组列出 CRUD + 外键引用点，每条带 `文件:行`。

---

## 一、Schema 层：字段定义 + 物理外键

文件：`src/db/schema/sqlite.ts` 与 `src/db/schema/pg.ts`（两文件同构，仅列类型/方言差异；以下行号同时给出 sqlite / pg）。

### 1.1 六张表字段

#### global_providers（全局服务商）
- sqlite `src/db/schema/sqlite.ts:104-123` / pg `src/db/schema/pg.ts:138-157`
- 字段：`id, name, protocol, baseUrl, apiKeysEnc, keyStrategy, enabled, priority, connectTimeoutMs, readTimeoutMs, streamIdleTimeoutMs, headersJson, lastHealthCheckedAt, lastHealthyKeyCount, lastTotalKeyCount, createdAt, updatedAt`

#### global_models（全局对外模型）
- sqlite `src/db/schema/sqlite.ts:125-142` / pg `src/db/schema/pg.ts:159-173`
- 字段：`id, name(唯一), displayName, vendor, icon, capabilities(jsonb/text), systemPrompt, description, accessScope(public|internal), enabled, sortOrder, createdAt, updatedAt`

#### global_routes（全局路由链）
- sqlite `src/db/schema/sqlite.ts:144-162` / pg `src/db/schema/pg.ts:175-193`
- 字段：`id, modelId→globalModels.id, providerId→globalProviders.id, upstreamModelName, priority, weight, enabled, headersJson, createdAt`
- 索引：`global_routes_model_idx(modelId)`

#### user_providers（用户 BYO 服务商）
- sqlite `src/db/schema/sqlite.ts:168-184` / pg `src/db/schema/pg.ts:199-215`
- 字段：`id, userId→user.id, name, protocol, baseUrl, apiKeyEnc, enabled, lastHealthCheckedAt, lastHealthyKeyCount, lastTotalKeyCount, createdAt, updatedAt`
- 与全局差异：单 key（`apiKeyEnc` 比 `apiKeysEnc` 少一个 s）、无 priority / timeout / headersJson、带 userId 隔离

#### user_models（用户 BYO 模型）
- sqlite `src/db/schema/sqlite.ts:186-211` / pg `src/db/schema/pg.ts:217-239`
- 字段：`id, userId→user.id, providerId→userProviders.id(遗留 nullable), name, upstreamModelName(遗留), capabilities, displayName, vendor, systemPrompt, description, enabled, sortOrder, createdAt`
- 注释明确：`providerId` / `upstreamModelName` 为**遗留列**，多路由上线后改由 `user_routes` 承载（sqlite:191-192 / pg:222-223 注释）。网关与新建逻辑已不再读它们。

#### user_routes（用户模型多路由，镜像 global_routes + userId）
- sqlite `src/db/schema/sqlite.ts:215-236` / pg `src/db/schema/pg.ts:243-264`
- 字段：`id, userId→user.id, userModelId→userModels.id, providerId→userProviders.id, upstreamModelName, priority, weight, enabled, headersJson, createdAt`
- 索引：`user_routes_model_idx(userModelId)`

### 1.2 物理外键引用点（`.references(() => xxx.id)`）

> 用 `rg "references\(\(\)" sqlite.ts pg.ts | rg "六表"` 全量扫过，**只有以下 7 处**，且 sqlite/pg 完全对称：

| 引用方表.列 | → 被引用表 | sqlite 行 | pg 行 | onDelete |
|---|---|---|---|---|
| `globalRoutes.modelId` | globalModels.id | 148-150 | 179-181 | cascade |
| `globalRoutes.providerId` | globalProviders.id | 151-153 | 182-184 | cascade |
| `userModels.providerId`（遗留列） | userProviders.id | 193-195 | 224-226 | cascade |
| `userRoutes.userModelId` | userModels.id | 222-224 | 250-252 | cascade |
| `userRoutes.providerId` | userProviders.id | 225-227 | 253-255 | cascade |
| `keyModelBindings.globalModelId` | globalModels.id | 250-252 | 280-282 | cascade |
| `keyModelBindings.userModelId` | userModels.id | 253-255 | 283-285 | cascade |

### 1.3 重要「非外键」澄清（排查重点表）

以下表/列看似相关，实为**纯文本快照列**，无 `.references()`，迁移时无 FK 约束要改：

| 表.列 | 类型 | 证据 |
|---|---|---|
| `conversations.modelName` | text | sqlite:283 / pg:312 — 存对外模型名字符串 |
| `runs.platformModelName` / `runs.routedBindingCode` / `runs.modelVendor` | text | sqlite:340-342 / pg:373-375 |
| `usageLogs.providerRef` / `routeId` / `routeName` / `upstreamModel` / `providerName` | text | sqlite:728-741 / pg 对应行 — 计费快照 |
| `opsErrorLogs.providerRef` / `routeId` / `routeName` / `upstreamModel` / `providerName` | text | sqlite:768-772 / pg 对应行 — 错误日志快照 |
| `keyModelBindings.scope` | text/enum("global"\|"byo") | sqlite:249 / pg:279 — 区分绑定来源的标记列，非 FK |

> 结论：**`apiKeys` / `conversations` / `messages` / `runs` / `toolCalls` / `usageLogs` / `opsErrorLogs` 这 7 张表都没有 FK 指向六张镜像表。** 唯一带 FK 的「外部消费者」是 `keyModelBindings`（子 key 绑定）。

---

## 二、providers 类引用地图

### 谁创建（insert）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin action | `createProvider(formData)` | globalProviders | `src/app/(dash)/admin/actions.ts:46-62`（insert @ 52） |
| panel action | `createMyProvider(formData)` | userProviders | `src/app/(dash)/panel/actions.ts:94-123`（insert @ 114） |
| smoke 测试 | 临时 seed | globalProviders | `scripts/smoke/routing.smoke.ts:38-48`（仅测试） |

### 谁读取（select）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin action | `listProviders()` | globalProviders | `src/app/(dash)/admin/actions.ts:40-44` |
| admin action | `checkProviderHealth(id)` | globalProviders（by id） | `src/app/(dash)/admin/actions.ts:128-131` |
| admin action | `listUpstreamModels(id)` | globalProviders（by id） | `src/app/(dash)/admin/actions.ts:160-163` |
| admin action | `testRoute(routeId)` | globalProviders（by route.providerId） | `src/app/(dash)/admin/actions.ts:187-190` |
| panel action | `getMyProviders()` | userProviders（by userId） | `src/app/(dash)/panel/actions.ts:88-91` |
| panel action | `checkMyProviderHealth(id)` | userProviders | `src/app/(dash)/panel/actions.ts:174-177` |
| panel action | `listMyUpstreamModels(id)` | userProviders | `src/app/(dash)/panel/actions.ts:206-209` |
| panel action | `createMyRoute` 校验归属 | userProviders | `src/app/(dash)/panel/actions.ts:433-436` |
| panel action | `updateMyRoute` 校验归属 | userProviders | `src/app/(dash)/panel/actions.ts:456-459` |
| panel action | `testMyRoute` | userProviders | `src/app/(dash)/panel/actions.ts:507-512` |
| **绕过 actions**：RAG 配置 | `loadConfig()` 读 embedding provider | globalProviders（by id） | `src/lib/rag/embedding.ts:57` |
| **绕过 actions**：admin 设置页 | `ModelConfigSection`（server 组件）list enabled | globalProviders | `src/app/(dash)/admin/settings/ModelConfigSection.tsx:41-45` |

### 谁更新（update）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `updateProvider(id, formData)` | globalProviders | `actions.ts:65-80`（update @ 78） |
| admin | `toggleProvider(id, enabled)` | globalProviders | `actions.ts:82-87` |
| admin | `checkProviderHealth` 回写健康度 | globalProviders | `actions.ts:143-151` |
| panel | `toggleMyProvider(id, enabled)` | userProviders | `panel/actions.ts:137-145` |
| panel | `updateMyProvider(id, formData)` | userProviders | `panel/actions.ts:224-250`（update @ 245） |
| panel | `checkMyProviderHealth` 回写健康度 | userProviders | `panel/actions.ts:189-197` |

### 谁删除（delete）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `deleteProvider(id)` | globalProviders | `actions.ts:89-94` |
| panel | `deleteMyProvider(id)` | userProviders（带 userId 归属校验） | `panel/actions.ts:126-134` |

### 谁外键引用
- `globalRoutes.providerId → globalProviders.id`（cascade）
- `userRoutes.providerId → userProviders.id`（cascade）
- `userModels.providerId → userProviders.id`（cascade，**遗留 nullable 列**）

---

## 三、models 类引用地图

### 谁创建（insert）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `createModel(formData)` | globalModels | `actions.ts:232-259`（insert @ 247，含 nextSort 计算 @ 243-246） |
| panel | `createMyModel(formData)` | userModels | `panel/actions.ts:287-315`（insert @ 303，per-user nextSort @ 298-302） |
| smoke | 临时 seed | globalModels | `scripts/smoke/routing.smoke.ts:53-62, 119` |

### 谁读取（select）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `listModels()` | globalModels | `actions.ts:210-218` |
| admin | `listRoutes()` join（含 providerName） | globalRoutes（路由类，见下） | `actions.ts:220-230` |
| panel | `getMyModels()` | userModels + userRoutes join userProviders | `panel/actions.ts:258-285`（models @ 263-266，routes @ 267-272） |
| panel | `getBindableModels()` | globalModels(public+enabled) ∪ userModels | `panel/actions.ts:386-403` |
| panel | `createMyRoute` 校验归属 | userModels | `panel/actions.ts:427-430` |
| runtime 路由 repo | `findEnabledGlobalModel(name)` | globalModels | `src/lib/repositories/route-repository.ts:49-59` |
| runtime 路由 repo | `findEnabledUserModel(name, userId)` | userModels | `route-repository.ts:61-77` |
| runtime 路由 | `listModelsByCapability` | globalModels + userModels | `src/lib/routing.ts:284-313` |
| **绕过 actions**：chat actions | `getVisibleModels()` | globalModels + userModels join userProviders | `src/features/chat/actions/conversations.ts:15-28` |
| **绕过 actions**：chat actions | `getImageModels()` | globalModels + userModels（按 imageGeneration 过滤） | `conversations.ts:32-51` |
| **绕过 actions**：gateway /v1/models | `GET` 主 key 分支 / 子 key 绑定回查 | globalModels + userModels | `src/app/v1/models/route.ts:48,55,65,71` |
| **绕过 actions**：MCP list_models 工具 | `globalModels`（public+enabled） | `src/app/v1/mcp/route.ts:131-133` |
| **绕过 actions**：orchestrator | 查 `globalModels` 取 capabilities.vision | `src/lib/chat/orchestrator.ts:105-109` |
| **绕过 actions**：compact 摘要 | 取 `globalModels`（accessScope=internal 优先） | `src/lib/compact/service.ts:219-225` |

### 谁更新（update）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `updateModel(id, formData)` | globalModels | `actions.ts:283-307`（update @ 293） |
| admin | `toggleModel(id, enabled)` | globalModels | `actions.ts:363-368` |
| admin | `reorderModels(orderedIds)` | globalModels（全表重写 sortOrder，事务） | `actions.ts:321-331` |
| panel | `updateMyModel(id, formData)` | userModels | `panel/actions.ts:340-362`（update @ 350） |
| panel | `toggleMyModel(id, enabled)` | userModels | `panel/actions.ts:375-383` |
| panel | `reorderMyModels(orderedIds)` | userModels（per-user，带 userId 条件，事务） | `panel/actions.ts:322-337` |

### 谁删除（delete）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `deleteModel(id)` | globalModels（路由靠 cascade 自动删） | `actions.ts:309-315` |
| panel | `deleteMyModel(id)` | userModels（带 userId 校验） | `panel/actions.ts:365-372` |

### 谁外键引用
- `globalRoutes.modelId → globalModels.id`（cascade）
- `userRoutes.userModelId → userModels.id`（cascade）
- `keyModelBindings.globalModelId → globalModels.id`（cascade）
- `keyModelBindings.userModelId → userModels.id`（cascade）

---

## 四、routes 类引用地图

### 谁创建（insert）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `createRoute(modelIdOrFormData, formData?)` | globalRoutes | `actions.ts:265-280`（insert @ 271） |
| panel | `createMyRoute(modelId, formData)` | userRoutes（先校验 model + provider 归属） | `panel/actions.ts:424-448`（insert @ 438） |
| smoke | 临时 seed | globalRoutes | `scripts/smoke/routing.smoke.ts:65` |

### 谁读取（select）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `listRoutes()` | globalRoutes join globalProviders | `actions.ts:220-230` |
| admin | `testRoute(routeId)` | globalRoutes + globalProviders | `actions.ts:182-190` |
| panel | `getMyModels()` 内联 | userRoutes join userProviders | `panel/actions.ts:267-272` |
| panel | `listMyRoutes(modelId?)` | userRoutes join userProviders | `panel/actions.ts:408-418` |
| panel | `testMyRoute(routeId)` | userRoutes + userProviders | `panel/actions.ts:502-512` |
| runtime repo | `findEnabledGlobalRoutes(modelId)` | globalRoutes join globalProviders | `route-repository.ts:105-129` |
| runtime repo | `findEnabledUserRoutes(userModelId)` | userRoutes join userProviders | `route-repository.ts:148-172` |
| runtime repo | `findEnabledUserProvider(providerId)` | userProviders | `route-repository.ts:131-146` |
| runtime repo | `findKeyModelBindings(keyId)` | keyModelBindings（间接触发模型可见集） | `route-repository.ts:79-103` |

### 谁更新（update）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `updateRoute(id, formData)` | globalRoutes | `actions.ts:334-347`（update @ 337） |
| admin | `toggleRoute(id, enabled)` | globalRoutes | `actions.ts:356-361` |
| panel | `updateMyRoute(id, formData)` | userRoutes | `panel/actions.ts:451-471`（update @ 461） |
| panel | `toggleMyRoute(id, enabled)` | userRoutes | `panel/actions.ts:484-492` |

### 谁删除（delete）
| 位置 | 函数 | 目标表 | 文件:行 |
|---|---|---|---|
| admin | `deleteRoute(id)` | globalRoutes | `actions.ts:349-354` |
| panel | `deleteMyRoute(id)` | userRoutes（带 userId 校验） | `panel/actions.ts:474-481` |

### 谁外键引用
- routes 类表本身**不被其他业务表 FK 引用**（只被 routes 内部 modelId/providerId 自指 + userModels.providerId 遗留列指向 userProviders）。
- `usageLogs.routeId` / `opsErrorLogs.routeId` 是**纯文本快照**，无 FK（见 1.3）。

---

## 五、bootstrap：是否内置 seed

`src/lib/infra/db/bootstrap.ts`（全文已读，1-756）：

- `bootstrapDatabase()`（22-48）步骤依次为：连通性探测 → pgvector → migrate → ensureFirstAdmin → ensureBuiltinRenderStyles → ensureBuiltinOutputModes → clearStaleGenerating。
- **结论：bootstrap 不 seed 这六张表。** 六张表在首次部署后为空，需管理员手动在 `/admin/providers`、`/admin/models` 配置。
- 相关：`PG_BASELINE_TABLES`（109-142）仅把六张表名列入「基线对象存在性校验」清单（用于 adoptExistingPgBaselineIfNeeded 判断是否已建表），**不写入数据**。

---

## 六、绕过 service 的直接 SQL 汇总（运行时 / 网关 / chat / 配置）

> 用 `rg "\.from\(S?\.?(global|user)(Providers|Models|Routes)\)"` 全量扫过 src/，除前述 actions / route-repository / routing 外，**额外发现以下直接读写点**（全部为只读 SELECT）：

| 文件:行 | 操作 | 用途 |
|---|---|---|
| `src/lib/rag/embedding.ts:57` | `db.select().from(s.globalProviders).where(eq(id, providerId))` | RAG embedding 从 system_settings 存的 provider_id 反查 provider 解密 key |
| `src/app/(dash)/admin/settings/ModelConfigSection.tsx:41-45` | `db.select({id,name}).from(s.globalProviders).where(enabled).orderBy(createdAt)` | admin 设置页 server 组件直接列 provider 供下拉选择（embedding/联网/标题任务配置） |
| `src/features/chat/actions/conversations.ts:15-28` | `getVisibleModels()` 并行查 globalModels + userModels join userProviders | WebChat 模型选择器 |
| `src/features/chat/actions/conversations.ts:32-51` | `getImageModels()` 查 globalModels + userModels | 图像生成模型过滤 |
| `src/app/v1/models/route.ts:48,55,65,71` | `GET /v1/models` 查 globalModels + userModels | OpenAI 兼容网关模型列表 |
| `src/app/v1/mcp/route.ts:131-133` | `list_models` 工具查 globalModels | MCP server 工具 |
| `src/lib/chat/orchestrator.ts:105-109` | 查 globalModels（by name）取 capabilities.vision | 多模态图片输入能力校验 |
| `src/lib/compact/service.ts:219-225` | 查 globalModels（internal 优先）取摘要模型 | 上下文压缩副任务 |
| `scripts/smoke/routing.smoke.ts:31-33,38,53,65,119` | delete + insert global{Routes,Models,Providers} | **仅冒烟测试**，非生产路径 |

补充：`src/lib/usage.ts:81,91,109,110` 与 `src/lib/usage-aggregate.ts:148,158,238,248`、`src/lib/repositories/error-log-repository.ts:23,24,134,135` 操作的是 `usageLogs` / `opsErrorLogs` 的 `providerRef` / `routeId` / `providerName` 等**快照文本列**，不构成对六张表的 FK 或 JOIN，迁移时仅需保证写入这些列的代码逻辑仍能取到对应字段值即可（即统一表里要保留能映射出 providerName/routeId 的能力）。

---

## 七、UI 层引用（仅展示，非直接 DB）

以下文件引用六张表名，但**仅作 i18n labelKey 或消费 server action 返回值**，不做 DB 操作，迁移时一般只需改文案/类型：
- `src/shared/nav-config.ts:34-35` — `labelKey: "globalProviders"/"globalModels"`（i18n 键）
- `src/app/(dash)/admin/providers/page.tsx:61` — `tn("globalProviders")`（i18n）
- `src/app/(dash)/admin/models/page.tsx:93` — `tn("globalModels")`（i18n）
- `src/app/(dash)/panel/keys/KeysManager.tsx:383` — `t("globalModels")` optgroup label（i18n）

---

## 八、迁移时要改的点（汇总清单）

> 按「schema → 数据迁移 → service → 运行时 → 绑定/快照」分层列出，供后续 implement 参考。仅枚举改点，不含实现方案。

### A. Schema 层（`src/db/schema/sqlite.ts` + `src/db/schema/pg.ts`，两处对称改）
1. **合并 providers**：`globalProviders` + `userProviders` → `providers`，新增 `ownerUserId`（null=全局/admin；非 null=用户私有）、`visibility`（或沿用 `accessScope` 思路）。字段差异需对齐：全局有 `apiKeysEnc/keyStrategy/priority/timeouts/headersJson`，用户版只有 `apiKeyEnc`——合并后需统一密钥 bundle 列名（当前 `apiKeyEnc` vs `apiKeysEnc` 差一个 s，见 routing.ts:36-49 `toResolvedProvider` 的 keyField 分支）。
2. **合并 models**：`globalModels` + `userModels` → `models`，新增 `ownerUserId` + `visibility`。`globalModels.name` 当前**全局唯一**，`userModels.name` 是 **per-user** 唯一语义（同 name 可被不同用户用）——合并后唯一约束需改为 `(ownerUserId, name)` 或 `(visibility, ownerUserId, name)`。
3. **合并 routes**：`globalRoutes` + `userRoutes` → `routes`，新增 `ownerUserId`。列名对齐：global 用 `modelId`，user 用 `userModelId`；合并后统一为 `modelId`。
4. **遗留列 `userModels.providerId/upstreamModelName`**（sqlite:191-195/pg:222-226）：已注释为遗留，合并时可考虑废弃（数据先迁到 routes）。
5. **改 FK 指向**（7 处，见 1.2 表）：routes.modelId/providerId、userModels.providerId（若废弃则删）、keyModelBindings.globalModelId/userModelId → 统一指向合并后的 `models.id` / `providers.id`。
6. **新增 drizzle migration**：`drizzle/pg/` 与 `drizzle/sqlite/` 各加一份迁移 SQL；`bootstrap.ts:PG_BASELINE_TABLES`（109-142）与 `PG_BASELINE_TYPES`（101-107）清单需同步更新（删 6 旧表名加 3 新表名）。

### B. 数据迁移脚本
7. 写一次性脚本：把 6 张表数据搬到 3 张统一表，回填 `ownerUserId`（global→null/admin，user→原 userId）与 `visibility`。注意 `userModels.providerId` 遗留列已迁到 `user_routes` 的需去重。

### C. service / actions 层（CRUD 改写）
8. `src/app/(dash)/admin/actions.ts`：providers/models/routes 的全部 CRUD（见二/三/四的 admin 行）改为操作统一表 + 按 `ownerUserId IS NULL`（或 visibility=public）过滤全局。
9. `src/app/(dash)/panel/actions.ts`：BYO 的全部 CRUD 改为操作统一表 + 按 `ownerUserId = user.id` 过滤。`createMyRoute`（panel:424-448）的 model/provider 归属校验逻辑保留。
10. `reorderModels` / `reorderMyModels`（actions.ts:321-331 / panel:322-337）：sortOrder 全表重写需加 ownerUserId 过滤，避免改到他人/全局顺序。

### D. 运行时路由层（核心，影响网关）
11. `src/lib/repositories/route-repository.ts`：`DrizzleRouteRepository` 6 个方法（49/61/79/105/131/148）全部改读统一表，全局/BYO 的区分改为 `ownerUserId IS NULL` vs `= ctx.userId`。
12. `src/lib/routing.ts`：`resolveRoutes`（58）、`resolveGlobalRoutes`（106）、`resolveByoRoute`（145）、`resolveRoutesByCapability`（250）、`listModelsByCapability`（271）——全局/BYO 双分支可考虑合并单查询；`toResolvedProvider`（36-49）的 `keyField`（"apiKeysEnc" vs "apiKeyEnc"）差异需随 schema 统一消除。

### E. 绕过 service 的直接读写点（全部为只读，见六）
13. `src/lib/rag/embedding.ts:57` 改读统一 providers（按 id）。
14. `src/app/(dash)/admin/settings/ModelConfigSection.tsx:41-45` 改读统一 providers（列全局启用的）。
15. `src/features/chat/actions/conversations.ts:15-28,32-51`（getVisibleModels / getImageModels）改读统一 models。
16. `src/app/v1/models/route.ts:48,55,65,71`（GET /v1/models）改读统一 models。
17. `src/app/v1/mcp/route.ts:131-133`（list_models 工具）改读统一 models。
18. `src/lib/chat/orchestrator.ts:105-109`（vision 能力校验）改读统一 models。
19. `src/lib/compact/service.ts:219-225`（摘要模型选取）改读统一 models。

### F. 绑定 / 快照列（无 FK，但语义相关）
20. `keyModelBindings.scope`（"global"\|"byo"）+ `globalModelId`/`userModelId` 双列（sqlite:249-255/pg:279-285，及 panel/actions.ts:60-81 的 `bindModel`、route-repository.ts:79-103 的 `findKeyModelBindings`、v1/models/route.ts:44-60 的子 key 绑定回查）：合并后可改为单 `modelId` + 统一 scope 语义，或保留 scope 作软标记。
21. `usageLogs` / `opsErrorLogs` 的 `providerRef/routeId/routeName/providerName/upstreamModel` 快照列（见 1.3）：**无需改 schema**，但写入侧（`src/lib/usage.ts`、网关 stream 流程）需保证从统一表仍能取到这些展示字段。

### G. 测试 / 冒烟
22. `scripts/smoke/routing.smoke.ts:31-33,38,53,65,119` 改为操作统一表。
23. `src/lib/routing.test.ts` / `route-repository` 的 mock（若有）需同步更新类型。

---

## Caveats / Not Found

- **未读全 pg.ts 300 行之后**：pg.ts 在 300 行后的表（conversations/messages/runs/.../usageLogs/opsErrorLogs）已通过「FK references 全量扫描」确认无对六表的 FK（1.3 节），但若需要逐字段比对 pg 与 sqlite 同构，建议 implement 阶段再 diff 一次。
- **未追踪客户端组件**：`admin/providers/page.tsx`、`admin/models/page.tsx`、`panel/keys/KeysManager.tsx` 等客户端组件假定只消费 server action 返回值；若它们对返回行形状（如 `model.providerName`、`route.providerName`）有强类型依赖，合并表后这些字段名可能变化，需在改 actions 时同步检查调用方。本次只确认了它们不含直接 DB 调用。
- **未确认 drizzle 迁移产物现状**：`drizzle/pg/*.sql` 与 `drizzle/sqlite/*.sql` 的当前基线迁移内容未逐一打开（bootstrap 只引用路径）。合并表需新增迁移文件，建议 implement 时先 `ls drizzle/` 看现有迁移序号。
- **`visibility` 取值语义未定**：本调研只标出「需要新增 visibility 列」，具体枚举（如 `public/internal/private` 或 `global/shared/private`）属设计决策，需在 PRD 阶段确定，不在本调研范围。
