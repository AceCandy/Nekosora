# Research: 网关 / 路由层 — 请求如何被解析到上游

- **Query**: 找网关入口，确认全局模型 priority/weight 选路由的逻辑、个人模型当前 1:1 解析逻辑、个人改多路由后网关要改哪些位置
- **Scope**: internal
- **Date**: 2026-07-07

## 核心结论

网关路由的**唯一决策中枢**是 `src/lib/routing.ts` 的 `resolveRoutes(ctx, modelName)`。它先查全局模型（走多路由 + priority/weight），找不到再查当前用户的 BYO 模型（走 1:1 单路由）。数据访问已被抽象进 `RouteRepository`（`src/lib/repositories/route-repository.ts`），便于测试注入。

个人模型改多路由后，**网关改动面极小**：只需给 Repository 加一个 `findEnabledUserRoutes()` 方法 + 重写 `resolveByoRoute()` 复用已有的 `orderRoutes()`/`filterByCircuitBreaker()`。下游 `streamChat` 的故障转移循环**完全不用动**（它本就按 `routes[]` 数组遍历）。

## Findings

### 关键文件

| File Path | Description |
|---|---|
| `src/lib/routing.ts` | 路由决策中枢（`resolveRoutes` + 全局/BYO 分支 + 加权排序 + 熔断过滤） |
| `src/lib/repositories/route-repository.ts` | 数据访问抽象（`RouteRepository` 接口 + Drizzle 实现 + 测试可注入） |
| `src/lib/stream.ts` | `streamChat`：调 `resolveRoutes` 拿路由链 → 逐路由故障转移 × 路由内逐 key 重试 |
| `src/lib/providers/types.ts` | `ResolvedRoute` / `ResolvedProvider` / `CallContext` 类型定义 |
| `src/app/v1/chat/completions/route.ts` | OpenAI 兼容网关入口（`POST /v1/chat/completions`）→ 调 `streamChat` |
| `src/app/v1/models/route.ts` | `GET /v1/models`：列出可见模型（全局 public ∪ 用户 BYO） |
| `src/lib/providers/multimodal/{image-gen,audio-stt,audio-tts}.ts` | 多模态端点，复用 `resolveRoutesByCapability` 拿同一套路由链 |

### 路由解析主流程（`resolveRoutes`）

执行顺序（概念性描述，不依赖行号）：

1. **子 key 绑定约束**：若 `ctx.keyKind === "sub"`，先查 `key_model_bindings` 拿到该 key 允许的 `globalModelIds` / `userModelIds` 白名单（主 key/WebChat 不受限）。
2. **先查全局模型**：`repo.findEnabledGlobalModel(modelName)`。命中则：
   - `accessScope === "internal"` 且来源是 gateway → 拒绝（internal 仅系统任务用）。
   - 子 key 校验绑定。
   - 进入 `resolveGlobalRoutes()`。
3. **再查 BYO 模型**：`repo.findEnabledUserModel(modelName, ctx.userId)`。命中则校验绑定 → 进入 `resolveByoRoute()`。
4. 都没命中 → 抛 `RoutingError("model_not_found")`。

### 全局模型：多路由 + priority/weight（`resolveGlobalRoutes`）

- `repo.findEnabledGlobalRoutes(modelId)`：join `global_routes` + `global_providers`，过滤 `route.enabled && provider.enabled`，按 `priority` 升序返回。
- 映射成 `ResolvedRoute[]`（含 `upstreamModelName`/`protocol`(取自 provider)/`provider`/`priority`/`weight`/`source:"global"`/`globalModelId`/`capabilities`）。
- `orderRoutes()`：按 `priority` 分组 → 组内 `weightedShuffle()`（按 weight 加权无放回抽取，权重高的排前）→ 拼成有序链。
- `filterByCircuitBreaker()`：跳过熔断 open 态的 provider；若全被熔断则降级返回全集（避免雪崩 503）。
- 返回有序链，调用方按序尝试，失败故障转移。

### 个人模型：当前 1:1 单路由（`resolveByoRoute`）

```
repo.findEnabledUserProvider(userModel.providerId)  // 查唯一 provider
→ 返回单元素数组：
   { modelName, upstreamModelName: userModel.upstreamModelName,
     protocol: provider.protocol, provider: toResolvedProvider(provider, "apiKeyEnc"),
     priority: 0, weight: 1, source: "byo", userModelId, capabilities }
```

**关键点**：
- `upstreamModelName` 直接取自 `user_models` 行，`priority/weight` **硬编码**为 0/1。
- `toResolvedProvider()` 第二参数是 `"apiKeyEnc"`（个人 provider 的密钥列名），全局是 `"apiKeysEnc"`——这是两套 provider 唯一的字段名差异点。
- **不经过 `orderRoutes()` / `filterByCircuitBreaker()`**（单条无需排序，但**也就意味着 BYO 路由当前不参与熔断过滤**——这是一个细微差异）。

### 下游消费：`streamChat` 故障转移循环

`streamChat` 拿到 `routes: ResolvedRoute[]` 后：
- 外层逐路由遍历（`for (i in routes)`）。
- 内层逐 key 遍历（路由内 provider 的 keys 加权打乱）。
- 成功 → 重置该 provider 熔断器 → break。
- key 认证错误 + 还有备选 key → 换 key 重试（不跨路由）。
- 其他错误 → 路由级故障转移（下一条 route）。

**这个循环对 route 来源透明**：无论 `source:"global"` 还是 `"byo"`，只要 `routes[]` 有多条，故障转移就自然生效。所以 BYO 改多路由后，**streamChat 无需改动**。

### `RouteRepository` 抽象（测试解耦点）

接口方法（`route-repository.ts`）：
- `findEnabledGlobalModel(modelName)`
- `findEnabledUserModel(modelName, userId)`
- `findKeyModelBindings(keyId)` → `{ globalModelIds, userModelIds }`
- `findEnabledGlobalRoutes(modelId)` → `Array<{ route, provider }>`（已按 priority 升序）
- `findEnabledUserProvider(providerId)` → 单 provider 行

`setRouteRepository()` 可在测试注入 mock。**这是加 BYO 多路由时最该扩展的抽象层**。

### 个人模型改多路由 → 网关改动面

| 改动位置 | 改什么 | 工作量 |
|---|---|---|
| `RouteRepository` 接口 + Drizzle 实现 | 新增 `findEnabledUserRoutes(userModelId)`：join `user_routes` + `user_providers`，过滤 enabled，按 priority 升序 | 小（参照 `findEnabledGlobalRoutes` 照搬，改表名 + 密钥列名 `apiKeyEnc`） |
| `routing.ts` 的 `resolveByoRoute()` | 改为查 `findEnabledUserRoutes(userModel.id)`，映射成 `ResolvedRoute[]`，复用 `orderRoutes()` + `filterByCircuitBreaker()`（与全局对齐，顺便让 BYO 也获得熔断过滤） | 小（~15 行重写） |
| `stream.ts` | **无需改动**（routes 数组消费方与来源无关） | 0 |
| `resolveRoutesByCapability` / `listModelsByCapability` | 无需改（它们基于 `resolveRoutes`，BYO 多路由自动受益；capabilities 仍取自 `user_models.capabilities`） | 0 |

补充：`ResolvedRoute` 类型已天然支持 BYO 多路由（`priority/weight/source/userModelId/capabilities` 字段都在），无需改类型。

### 其他网关相关观察

- `GET /v1/models`（`v1/models/route.ts`）：列模型时只读 `user_models.name`，**与路由无关**，加多路由不影响模型列表。
- 多模态（image/audio）端点调 `resolveRoutesByCapability`，BYO 模型若声明了 `imageGeneration` 等能力，改多路由后自动获得多路由故障转移能力。
- `resolveByoRoute` 当前**不过熔断过滤**，改多路由复用 `filterByCircuitBreaker` 后会引入熔断——需确认个人 provider 是否已接入熔断器 key（`isProviderAllowed(provider.id)` 用 provider.id 作 key，个人 provider 的 id 也能用，无障碍）。

## Caveats / Not Found

- 未发现任何「BYO 多路由」相关分支或 TODO——当前是纯 1:1 实现。
- 熔断器（`src/lib/circuit-breaker.ts`）以 `provider.id` 为 key，全局/个人 provider 的 id 都是 UUID，不会冲突；但个人 provider 接入熔断后，若某个人 provider 持续故障会被熔断，需确认这是期望行为（大概率是）。
