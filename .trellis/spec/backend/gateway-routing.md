# Gateway Routing 决策契约

> 网关 + WebChat 如何把模型解析成有序上游路由链。统一资源模型(providers/models/routes + visibility)后,网关与 WebChat 走两条不同解析路径。改路由解析、动可见性、加新模型来源时按此契约。

---

## Scenario: 统一资源模型(三表 + 可见性)

- `providers`(无 visibility,恒 private):服务商 + key bundle,`unique(ownerUserId, name)`,密钥列统一 `apiKeysEnc`。
- `models`(有 visibility):`visibility: "public"|"private"`,public 全局唯一(应用层发布时校验),`unique(ownerUserId, name)`。
- `routes`:关联 model↔provider,带 priority/weight,`ownerUserId` 跟随 model owner。
- `key_model_bindings`:收敛为单 `modelId`(原 globalModelId/userModelIds 合并),`unique(keyId, modelId)`。
- `source: "global"|"byo"` 保留,语义从「哪张表」改为「模型 visibility」:`public→"global"`、`private→"byo"`(避免大面积重命名 i18n/类型)。

---

## Scenario: resolveRoutes 决策树(网关路径 · by name + owner-only)

### 1. Trigger
`POST /v1/chat/completions`、`/v1/images/generations`、`/v1/audio/*` 等网关端点(sk 鉴权),以及 `resolveRoutesByCapability`。

### 2. Signatures
- `resolveRoutes(ctx, modelName)`(`src/lib/routing.ts`)——网关路由决策。
- `RouteRepository`(`src/lib/repositories/route-repository.ts`)——数据访问抽象,测试可注入 mock。

### 3. Contracts(决策顺序)
1. `findEnabledModelByNameForOwner(modelName, ctx.userId)` → model。null → `RoutingError("model_not_found")`。**网关 owner-only:public 对网关不可见**。
2. 子 key 绑定约束:`ctx.keyKind==="sub"` 查 `findKeyModelBindings(ctx.apiKeyId).modelIds`,`model.id` 不在集合 → `model_not_bound`(主 key/WebChat 不受限)。
3. `resolveModelRoutes(model)`:`findEnabledRoutes(modelId)` join providers,orderBy priority asc。
4. 都没命中 → `RoutingError("model_not_found")`。

---

## Scenario: resolveRoutesById 决策树(WebChat 路径 · by id + 可见性)

### 1. Trigger
WebChat 发消息、图像工作室生成(session 鉴权)。前端传 `modelId` 而非 name,避免 public/private 同名歧义。

### 2. Signatures
- `resolveRoutesById(ctx, modelId)`(`src/lib/routing.ts`)。
- 分流入口:`opts.modelId ? resolveRoutesById : resolveRoutes`(`src/lib/stream.ts`、`src/lib/providers/multimodal/image-gen.ts`)。

### 3. Contracts
1. `findEnabledModelById(modelId)` → model。null → `model_not_found`。
2. 可见性校验:`visibility==="public"` 或 `ownerUserId===ctx.userId`,否则 `model_not_found`(**不泄露存在性**)。
3. 子 key 绑定校验同网关路径。
4. `resolveModelRoutes(model)`。

---

## Scenario: 可见性四套场景

| 场景 | 规则 |
|---|---|
| 网关 API(`/v1/*`) | 只 `owner=请求者`(子 key 则 key 所属用户)。public 不可见 |
| WebChat 选择器 | `public` ∪ `(private && owner=自己)`,private 排序在前 |
| 后台管理(models/routes) | admin:`public` ∪ `(private && owner)`;user:仅 `(private && owner)` |
| 后台管理(providers) | 仅 owner(无 public) |

权限矩阵见 task `07-10-unify-resource-model/design.md` §4。核心:每个 server action 先 `requireSession()`,再按 `role`+`ownerUserId`+`visibility` 校验;`reorderXxx` 全表 sortOrder 重写必须带 `where(ownerUserId)`(沿用 `list-drag-sort` spec)。

---

## Scenario: 路由排序与熔断(不变)
- `orderRoutes(routes)`:priority 升序分组,组内 `weightedShuffle`(按 weight 加权无放回抽取)。
- `filterByCircuitBreaker(routes)`:跳过熔断 open 态 provider;全熔断则**降级返回全集**(避免雪崩 503)。熔断 key 是 `provider.id`。
- 核心算法 `orderRoutes`/`weightedShuffle`/`filterByCircuitBreaker`/`pickWeightedKey`/`parseKeyBundle` 原样保留,对 route 来源透明。
- 下游 `streamChat` 拿到 `routes[]` 后逐路由故障转移 × 路由内逐 key 重试,对 `source` 透明。

## Scenario: 熔断状态机与失败上报

### 1. Scope / Trigger

修改 `circuit-breaker.ts` 状态转换，或修改 `streamChat` / `generateChat` 的路由失败处理时，必须保持本节契约。目标是防止 half-open 并发探测冲击刚恢复的 provider，并确保终端路由失败也能更新健康状态。

### 2. Signatures

- `isProviderAllowed(providerId: string): boolean`
- `recordSuccess(providerId: string): void`
- `recordFailure(providerId: string): void`
- `isFailoverableError(err: unknown): boolean`

### 3. Contracts

- `closed`：允许请求；连续可转移失败达到 threshold 后转 `open`。
- `open`：冷却期内拒绝；到期后的第一个调用转 `half-open` 并放行。
- `half-open`：表示唯一探测名额已占用；结果回报前其他调用必须拒绝。
- 探测成功调用 `recordSuccess` 回到 `closed`；探测失败调用 `recordFailure` 立即重新 `open` 并刷新冷却时间。
- `streamChat` / `generateChat` 必须先判断错误是否可转移；若可转移，先 `recordFailure`，再判断是否存在下一条路由。
- `model_not_found`、`invalid_request`、context length 等确定性请求错误不计入 provider 失败。

### 4. Validation & Error Matrix

| 条件 | breaker 行为 | 路由行为 |
|---|---|---|
| open 且冷却未到 | 拒绝 | 过滤该 provider |
| open 且冷却到期的首个调用 | 转 half-open，放行 | 执行一次探测 |
| half-open 且探测未回报 | 拒绝 | 不重复探测 |
| 可转移错误，仍有后续路由 | 记录失败 | 转移下一路由 |
| 可转移错误，已是最后/唯一路由 | 记录失败 | 返回生成失败 |
| 确定性请求错误 | 不记录失败 | 停止转移 |

### 5. Good / Base / Bad Cases

- Good：多个请求在冷却边界并发到达，只有第一个获得 half-open 探测名额。
- Base：普通 closed provider 成功后保持 closed；可转移失败按 route 一次计数。
- Bad：唯一 provider 连接超时，因为没有下一条路由而未记录失败，导致 breaker 永远无法达到 threshold。

### 6. Tests Required

- `circuit-breaker.test.ts`：断言 half-open 首次 `true`、再次 `false`；覆盖探测成功恢复和失败重开。
- `stream-circuit-breaker.test.ts`：分别通过 `generateChat` 和 `streamChat` 断言唯一可转移失败使 `failures + 1`。
- 两条生成路径都要断言确定性请求错误保持 `failures=0`。

### 7. Wrong vs Correct

```typescript
// Wrong:最后一条路由提前退出,失败不会进入 breaker。
if (i === routes.length - 1 || !isFailoverableError(lastError)) break;
recordFailure(route.provider.id);

// Correct:健康上报与“是否还有后续路由”解耦。
const failoverable = isFailoverableError(lastError);
if (failoverable && route.provider.id) recordFailure(route.provider.id);
if (i === routes.length - 1 || !failoverable) break;
```

---

## Gotcha
- **密钥列名统一**:providers 表密钥列固定 `apiKeysEnc`(原 `global_providers.apiKeysEnc` 与 `user_providers.apiKeyEnc` 差异已消除)。`toResolvedProvider` 不再传 keyField。
- **重名消解**:网关 owner-only + `unique(ownerUserId, name)` → owner 内无重名,by name 无歧义;WebChat 改传 modelId,UI 同名显示为两选项(public 带 badge),用户选哪个调哪个,无歧义。
- **accessScope/internal 已砍**:原系统任务专用 internal 语义移除,compact/orchestrator 改读 `visibility=public && enabled`。
- **网关端点别误放 public**:`/v1/models`、`/v1/mcp` list_models、`/v1/images/generations`、`/v1/audio/*` 都是网关语义 owner-only,不能列/调 public 模型。WebChat 端点(`/api/chat`、`/api/images/generate`)才走 byId+可见性。

---

## 相关
- `src/lib/routing.ts`(`resolveRoutes`/`resolveRoutesById`/`resolveModelRoutes`/`orderRoutes`/`filterByCircuitBreaker`)。
- `src/lib/repositories/route-repository.ts`(数据访问抽象,测试注入点)。
- `src/lib/stream.ts`(故障转移循环 + byId/byName 分流)。
- `src/lib/providers/multimodal/image-gen.ts`(图像 byId 分流)。
- `src/lib/circuit-breaker.ts`(熔断,按 `provider.id`)。
- `src/lib/routing.test.ts`(网关 owner-only + byId 可见性 + 子 key 绑定单测)。
- `src/lib/providers/multimodal/image-gen.test.ts`(图像 byId 可见性 + 网关 owner-only 回归防护)。
