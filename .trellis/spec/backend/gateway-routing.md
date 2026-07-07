# Gateway Routing 决策契约

> OpenAI 兼容网关如何把一个模型名解析成有序上游路由链。改路由解析、动熔断、加新模型来源(scope)时按此契约。

---

## Scenario: resolveRoutes 决策树

### 1. Scope / Trigger
- Trigger: `POST /v1/chat/completions`、多模态端点、`resolveRoutesByCapability` 解析模型名时。

### 2. Signatures
- `resolveRoutes(ctx, modelName)`(`src/lib/routing.ts`)——网关路由唯一决策中枢。
- `RouteRepository`(`src/lib/repositories/route-repository.ts`)——数据访问抽象,测试可注入 mock。
- `ResolvedRoute`(`src/lib/providers/types.ts`)——`{ modelName, upstreamModelName, protocol, provider, priority, weight, source, ...capabilities }`。

### 3. Contracts(决策顺序)
1. 子 key 绑定约束:`ctx.keyKind==="sub"` 先查 `key_model_bindings` 拿允许的 `globalModelIds`/`userModelIds` 白名单(主 key/WebChat 不受限)。
2. 先全局:`repo.findEnabledGlobalModel(modelName)`。命中且 `accessScope==="internal"` 且来源是 gateway → 拒绝。→ `resolveGlobalRoutes`。
3. 再个人 BYO:`repo.findEnabledUserModel(modelName, ctx.userId)`。→ `resolveByoRoute`。
4. 都没命中 → `RoutingError("model_not_found")`。

### 4. 路由排序与熔断(global 与 byo 同构)
- `orderRoutes(routes)`:按 `priority` 升序分组,组内 `weightedShuffle`(按 weight 加权无放回抽取)。
- `filterByCircuitBreaker(routes)`:跳过熔断 open 态 provider;全熔断则**降级返回全集**(避免雪崩 503)。
- **global 与 byo 都走 `filterByCircuitBreaker(orderRoutes(resolved))`**,即 BYO 路由也接入熔断(个人 provider 持续故障会被跳过)。熔断 key 是 `provider.id`(全局/个人 provider id 都是 UUID,不冲突)。
- 下游 `streamChat` 拿到 `routes[]` 后逐路由故障转移 × 路由内逐 key 重试,**对 route 来源(`source:"global"`/`"byo"`)透明**;加新模型来源无需改 stream。
- 个人模型已是多路由(镜像全局):数据走 `user_routes`(独立表 + userId 隔离),解析走 `resolveByoRoute` → `findEnabledUserRoutes`,与全局四表路由器同构。

### 5. Gotcha:全局/个人 provider 密钥列名不同
- `global_providers` 的密钥列是 `apiKeysEnc`(复数 s)。
- `user_providers` 的密钥列是 `apiKeyEnc`(单数)。
- repository 查 provider 时密钥列名必须传对,否则读不到 key bundle:`findEnabledGlobalRoutes` 用 `apiKeysEnc`,`findEnabledUserRoutes` 用 `apiKeyEnc`。

### 6. 相关
- `src/lib/routing.ts`(`resolveRoutes`/`resolveGlobalRoutes`/`resolveByoRoute`/`orderRoutes`/`filterByCircuitBreaker`)。
- `src/lib/repositories/route-repository.ts`(数据访问抽象,测试注入点)。
- `src/lib/stream.ts`(故障转移循环,对来源透明)。
- `src/lib/circuit-breaker.ts`(熔断,按 `provider.id`)。
