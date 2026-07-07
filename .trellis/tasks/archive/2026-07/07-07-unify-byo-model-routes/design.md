# 设计：个人模型统一为多路由

技术设计。需求与验收见 `prd.md`，事实依据见 `research/`。

## 数据模型

### 新增 `user_routes` 表（镜像 `global_routes` + userId）

字段：`id` / `userId`(FK→`user` cascade) / `userModelId`(FK→`user_models` cascade) / `providerId`(FK→`user_providers` cascade) / `upstreamModelName` / `priority`(default 0) / `weight`(default 1) / `enabled`(default true) / `headersJson` / `createdAt`。在 `userModelId` 上建索引。

- 与 `global_routes` 的差异：多一个 `userId`（隔离），`modelId`→`userModelId`，`providerId` 指向 `user_providers`。
- 双 schema 同步：`pg.ts` + `sqlite.ts` 各加一份定义。

### `user_models` 扩列

新增 `displayName` / `vendor` / `systemPrompt` / `description`（均 nullable）。保留 `providerId` / `upstreamModelName` 标遗留——本期不下线，但网关与新建逻辑不再读它们。

### 迁移 `0003`

- `drizzle/pg/0003_*.sql` + `drizzle/sqlite/0003_*.sql` 各一份。
- 内容：建 `user_routes` + `user_models` 加 4 列 + **数据补种**（每条 `user_models` 用其 `providerId`/`upstreamModelName` 生成 1 条 `user_routes`，`priority=0, weight=1, enabled=true`）。
- 幂等：补种用 `ON CONFLICT DO NOTHING` 或先查后插，重复执行不产生重复路由。

## 网关

### `RouteRepository` 扩展

新增 `findEnabledUserRoutes(userModelId)`：join `user_routes` + `user_providers`，过滤 `route.enabled && provider.enabled`，按 `priority` 升序返回。密钥列名用 `apiKeyEnc`（注意比全局的 `apiKeysEnc` 少一个 `s`）。参照 `findEnabledGlobalRoutes` 照搬，改表名 + 密钥列名。

### `routing.ts` 的 `resolveByoRoute` 重写

查 `findEnabledUserRoutes(userModel.id)` → 映射成 `ResolvedRoute[]`（`source:"byo"`、`userModelId`、`capabilities` 取自 `user_models`）→ 复用 `orderRoutes()` + `filterByCircuitBreaker()`，与全局分支完全对齐。**这就让个人路由接入熔断**（产品已确认）。

### 零改动

`stream.ts` 故障转移循环、`GET /v1/models`、多模态端点、`resolveRoutesByCapability`——`routes[]` 消费方对来源透明，BYO 多路由自动受益。

## actions（panel）

### 新增（全部 `and(eq(userId, user.id))` 隔离）

| action | 要点 |
|---|---|
| `listMyRoutes(modelId?)` | 查 `user_routes` where `userId`（可选再加 `userModelId`） |
| `createMyRoute(modelId, formData)` | 校验 `modelId` 归属当前用户；写 `user_routes` |
| `updateMyRoute(id, formData)` | 改 `providerId/upstreamModelName/priority/weight`（`userModelId` 不可改） |
| `deleteMyRoute(id)` / `toggleMyRoute(id, enabled)` | where `userId` 隔离 |
| `testMyRoute(routeId)` | 从 `user_routes` 取 `upstreamModelName`+`providerId` → `user_providers` → `pickWeightedKey` → `probeProviderKey` → 喂熔断。路径与旧 `testMyModel` 同构，数据源从 model 行换成 route 行 |

### 改造

- `createMyModel` / `updateMyModel`：去掉 `providerId` / `upstreamModelName` 入参；加 `displayName` / `vendor` / `systemPrompt` / `description`。
- `getMyModels`：返回结构扩展，带该模型的 `routes` 数组（供前端组装）。
- 删除 `testMyModel`：前端 byo 测试改走 `testMyRoute`（与 global 同构，测试按钮在路由行）。删除前确认无其他引用。

## 前端

### `ModelsManager` byo 分支对齐 global

- 列表列改为：外部名 / 显示名 / 厂商 / 路由数 / 状态 / 操作（去掉 byo 特有的「上游模型名 / Provider」列，这些信息进路由面板）。
- model 行加路由展开按钮，复用 `RouteListPanel`（byo 可用）。
- model 行去掉 `testModelActions` 测试按钮（global model 行也没有，测试在 route 行）。

### `ModelFormDialog` byo

- 字段对齐 global：`name` / `displayName` / `vendor` / `systemPrompt` / `description` / `capabilities`。去掉 `providerId` / `upstreamModelName`（移到 `RouteFormDialog`）。byo 不加 `accessScope`。

### `panel/models/page.tsx`

- 传 `routes` + `createRouteActions` / `updateRouteActions` / `deleteRouteActions` / `toggleRouteActions` / `testRouteActions` + `providers`（仿 `admin/models/page.tsx`）。
- `getMyModels` 返回带 routes，page 组装 `routeItems`（仿 admin）。

## 迁移与回滚

- `0003` 含建表 + 加列 + 补种，幂等。
- 回滚：保留 `user_models` 旧两列，停用期可回退 `resolveByoRoute` 旧逻辑并忽略 `user_routes`。

## 风险

- 迁移必须先于网关逻辑切换，否则旧模型 `no_route`。
- 熔断接入是行为变化（已确认接受）：个人 provider 持续故障会被熔断。
- userId 隔离必须覆盖所有新 actions（内联 WHERE，无中心化 ownership 函数）。
- 删 `testMyModel` 前确认全仓无其他引用。
