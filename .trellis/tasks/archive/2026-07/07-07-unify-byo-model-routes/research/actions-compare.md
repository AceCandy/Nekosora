# Research: 后端 actions 对比 — admin vs panel

- **Query**: 对比 admin/panel 两端模型/路由 actions 的实现要点、权限隔离、testMyModel 测试路径
- **Scope**: internal
- **Date**: 2026-07-07

## 核心结论

两端 actions 是**同一套数据模型的两个视图**：admin 操作全局表（`global_*`），panel 操作个人表（`user_*`）并全程用 `userId` 隔离。关键差异是 **panel 完全没有路由 actions**——个人模型把 `providerId + upstreamModelName` 直接写在 model 上，所以 `createMyModel/updateMyModel` 同时承担了「建模型」和「挂路由」两件事，`testMyModel` 直接读 model 上的 1:1 字段测试。加多路由后，panel 需要补一整套 `*MyRoute` actions。

## Findings

### 关键文件

| File Path | Description |
|---|---|
| `src/app/(dash)/admin/actions.ts` | admin 端 server actions（操作 `global_providers/global_models/global_routes`） |
| `src/app/(dash)/panel/actions.ts` | panel 端 server actions（操作 `user_providers/user_models` + 子 key 绑定） |
| `src/lib/providers/probe.ts` | 共享探测层：`probeProviderKey`（双路：key 连通性 / 模型可用性）、`fetchUpstreamModels` |
| `src/lib/providers/keys.ts` | 共享密钥层：`encryptKeyBundle`/`parseKeyBundle`/`pickWeightedKey` |
| `src/lib/circuit-breaker.ts` | 共享熔断：`recordSuccess`/`recordFailure`/`isProviderAllowed` |
| `src/lib/session.ts` | 鉴权：`requireAdmin()` / `requireSession()` |
| `.trellis/spec/backend/provider-probe.md` | probe 契约 spec（明确提到 `testRoute`/`testByoModel` 的双路语义） |

### admin 端模型/路由 actions（`admin/actions.ts`）

统一鉴权：每个 action 首行 `await requireAdmin()`。无 userId 隔离（全局数据）。

**路由 actions（核心，panel 缺失的部分）：**
- `listRoutes()` —— join `global_routes` + `global_providers`，返回 `{ route, providerName }`。
- `createRoute(modelIdOrFormData, formData?)` —— `modelId` 既可 `.bind` 前缀传，也可 FormData 提供。写入 `global_routes`：`{ modelId, providerId, upstreamModelName, priority, weight, enabled:true }`。
- `updateRoute(id, formData)` —— 改 `providerId/upstreamModelName/priority/weight`（`modelId` 不可改）。
- `deleteRoute(id)` / `toggleRoute(id, enabled)`。
- `testRoute(routeId)` —— 读 `global_routes` 拿 `upstreamModelName` + `providerId` → 读 `global_providers` → `pickWeightedKey` 选 key → `probeProviderKey({ protocol, baseUrl, apiKey, upstreamModelName })`（发极小生成请求测具体模型）→ 喂熔断器（`recordSuccess`/`recordFailure`）。

**模型 actions：**
- `listModels()` —— `global_models` 按 `sortOrder` 排。
- `createModel(formData)` —— 写 `global_models`：`{ name, displayName, vendor, capabilities(JSON), accessScope, systemPrompt, description, enabled:true }`。
- `updateModel(id, formData)` / `deleteModel(id)`（级联删路由，因 `global_routes.modelId` 有 `onDelete:cascade`）/ `toggleModel(id, enabled)`。

**provider actions（参考）：** `listProviders/createProvider/updateProvider/toggleProvider/deleteProvider` + `testKeyDirect`/`checkProviderHealth`/`listUpstreamModels`。provider 的多 key 通过 `collectKeys(formData)` 收集 `keys[].key`/`keys[].weight`。

### panel 端个人模型 actions（`panel/actions.ts`）

统一鉴权：每个 action 首行 `const user = await requireSession()`。**所有写/删/改查询都复合 `and(eq(table.id, id), eq(table.userId, user.id))`** —— 在 SQL WHERE 层强制归属校验，无独立 ownership 函数。

**BYO 模型 actions（当前 1:1，无路由层）：**
- `getMyModels()` —— join `user_models` + `user_providers`，`where userId = user.id`，返回 `{ model, providerName }`。
- `createMyModel(formData)` —— 写 `user_models`：`{ userId, providerId, name, upstreamModelName, capabilities, enabled:true }`。**注意：`providerId`+`upstreamModelName` 在这里直接写入 model 行（这就是「建模型 = 挂唯一路由」）。无 priority/weight/enabled-route 概念。**
- `updateMyModel(id, formData)` —— 改 `providerId/name/upstreamModelName/capabilities`（`where userId` 隔离）。
- `deleteMyModel(id)` / `toggleMyModel(id, enabled)`。
- `testMyModel(modelId)` —— 读 `user_models`（校验 userId）→ 读 `user_providers`（校验 userId）→ `pickWeightedKey` → `probeProviderKey({ protocol, baseUrl, apiKey, upstreamModelName: model.upstreamModelName })` → 喂熔断器。**测试路径与 admin `testRoute` 完全同构，只是数据源从 route 行换成 model 行（1:1）。**

**BYO provider actions（已对齐 admin 模式）：**
- `getMyProviders/createMyProvider/updateMyProvider/deleteMyProvider/toggleMyProvider`。
- `testMyKeyDirect`（原始参数探测）/ `checkMyProviderHealth`（X/Y 落库）/ `listMyUpstreamModels`。
- 个人 provider 的多 key 写入与 admin 一致（`encryptKeyBundle`），列名是 `apiKeyEnc`（注意比 admin 的 `apiKeysEnc` 少一个 `s`）。

**子 key 绑定 actions：** `getBindings/bindModel/unbindBinding/getBindableModels`（`getBindableModels` 返回全局 public ∪ 我的 BYO，供子 key 绑定 UI）。

### 权限 / 隔离机制对比

| 维度 | admin | panel |
|---|---|---|
| 鉴权 | `requireAdmin()`（要求 role=admin） | `requireSession()`（任何登录用户） |
| 数据范围 | 全局表，无 userId 过滤 | `user_*` 表，**每条查询都 `and(eq(userId, user.id))`** |
| 隔离实现点 | 无需（数据本身全局共享） | SQL WHERE 复合条件，**内联在每个 action**，无中心化 ownership 函数 |
| 熔断接入 | `testRoute`/`checkProviderHealth` 喂熔断 | `testMyModel`/`checkMyProviderHealth` 喂熔断（共用同一熔断器，按 `provider.id` 区分） |

### `testMyModel` 测试路径详解（任务重点）

1. `requireSession()` → 拿 `user`。
2. 读 `user_models` where `id=modelId AND userId=user.id`（归属校验）→ 拿到 `model.providerId` + `model.upstreamModelName`。
3. 读 `user_providers` where `id=model.providerId AND userId=user.id`（再次归属校验，防越权）→ 拿到 `protocol/baseUrl/apiKeyEnc`。
4. `parseKeyBundle(apiKeyEnc)` → `pickWeightedKey` 选一个 key。
5. `probeProviderKey({ protocol, baseUrl, apiKey, upstreamModelName })` —— 传了 `upstreamModelName`，走 spec 契约里的「测具体模型」路径（极小 `generateText`，`maxOutputTokens:1`）。
6. 结果喂熔断器（`recordSuccess`/`recordFailure`，key 是 `provider.id`）。

与 admin `testRoute(routeId)` 的差异**仅在数据源**：admin 从 `global_routes` 行取 `upstreamModelName`，panel 从 `user_models` 行取。探测和熔断逻辑完全共享。

### 个人 actions 改多路由后的补全清单

参照 admin 的路由 actions，panel 需新增（均带 `userId` 隔离）：

| 新 action（建议命名） | 对应 admin | 关键差异 |
|---|---|---|
| `listMyRoutes(modelId?)` | `listRoutes` | `where user_routes.userId = user.id`（若按模型过滤再加 `userModelId`） |
| `createMyRoute(modelId, formData)` | `createRoute` | 写 `user_routes`，`userId` 来自 session；校验 `modelId` 归属当前用户 |
| `updateMyRoute(id, formData)` | `updateRoute` | `where userId` 隔离 |
| `deleteMyRoute(id)` / `toggleMyRoute(id, enabled)` | 同名 | `where userId` 隔离 |
| `testMyRoute(routeId)` | `testRoute` | 从 `user_routes` 取 `upstreamModelName`+`providerId`，其余同 `testMyModel`；**`testMyModel` 可保留为「测模型默认/首条路由」的便捷入口，或直接弃用改为 `testMyRoute`** |

`createMyModel/updateMyModel` 的字段需调整：去掉 `providerId/upstreamModelName`（移到 `createMyRoute`），保留 `name/capabilities`（以及若要对齐全局，可选加 `displayName/systemPrompt/description` 等）。数据迁移时把旧 `user_models` 的 `providerId/upstreamModelName` 补种成一条 `user_routes`。

## Caveats / Not Found

- panel 没有任何 `*Route*` 命名的 action——确认 BYO 路由层在 actions 层完全空白。
- `getMyModels` 返回 `{ model, providerName }`，前端目前直接读 `model.providerId/upstreamModelName`（见 ModelsManager byo 分支）；改多路由后这个返回结构需要扩展为带 routes 数组，前端也要相应调整（前端改造不在本次调研范围，已知背景）。
- `requireSession()` 的具体实现（`src/lib/session.ts`）未深读，但从调用方式可确认它返回 `{ id, ... }` 用户对象，且未抛异常即代表已登录。
