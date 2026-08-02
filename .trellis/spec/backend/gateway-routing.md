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

## Scenario: Admin Provider Reference Authorization

### 1. Scope / Trigger

Apply this contract to admin model/route and system-setting actions that accept a client-supplied Provider ID, and to route probes that resolve a Provider key from a client-supplied `routeId`.

### 2. Signatures

- `requireOwnedProvider(db, providerId, adminId)`
- `createModel(formData)`
- `createRoute(modelIdOrFormData, formData?)`
- `attachProviderModelRoute(modelId, providerId, upstreamModelName)`
- `updateRoute(routeId, formData)`
- `testRoute(routeId)`
- `saveEmbedding(formData)` with `provider_id` / `model`

### 3. Contracts

- Providers are always private. A model or route being public does not authorize an admin to submit another owner's Provider ID.
- Every non-empty client-supplied Provider reference is resolved with `providers.id = providerId` and `providers.owner_user_id = admin.id` before the first database, secret, network, cache, or revalidation side effect owned by that action.
- Every model/route write combines `providers.id = providerId` with `providers.owner_user_id = admin.id` before inserting or updating a route.
- A missing and a foreign Provider both fail with `服务商不存在`; the action must not reveal which condition occurred.
- `createModel` performs the Provider authorization inside its existing transaction and before the first model/route write.
- `saveEmbedding` authorizes a non-empty `provider_id` before updating `system_settings`, resetting the Embedding cache, or revalidating the settings page. An exact empty string keeps the existing clear-config behavior and skips the Provider lookup.
- `testRoute` authorizes the route through the existing public/private manageability rule before reading `apiKeysEnc`, probing upstream, or changing circuit-breaker state.
- Runtime route resolution intentionally follows an already-authorized route without requiring model and Provider owners to match. Public models can legitimately use a Provider voluntarily attached by a different admin, so authorization belongs at association time.
- Runtime Embedding resolution intentionally consumes the system setting without an admin identity. Authorization therefore belongs at the settings write boundary; changing this requires an owner-aware settings schema and is a separate contract.

### 4. Validation & Error Matrix

| Operation | Resource | Result |
|---|---|---|
| Create/update route | Caller-owned Provider | Continue with existing model/route permission checks |
| Create/update route | Missing or foreign Provider | Throw `服务商不存在` before write |
| Create model with initial route | Missing or foreign Provider | Reject transaction with no model or route |
| Save Embedding settings | Caller-owned Provider | Update settings, then reset cache and revalidate page |
| Save Embedding settings | Missing or foreign Provider | Throw `服务商不存在`; preserve settings and skip cache/revalidation side effects |
| Clear Embedding settings | Exact empty Provider ID | Skip Provider lookup and preserve existing clear behavior |
| Probe own private route | Referenced Provider | Probe and report breaker result |
| Probe public route manageable by admin | Referenced Provider | Probe and report breaker result |
| Probe another owner's private route | Any Provider | Throw before key parsing, probe, or breaker update |

### 5. Good / Base / Bad Cases

- Good: an admin attaches their own Provider to a public model owned by another admin; the route owner still follows the model owner.
- Good: an admin selects their own Provider for system-level Embedding; the saved global setting may then be consumed by background tasks.
- Base: an admin creates or updates a private route using their own Provider.
- Base: an exact empty `provider_id` clears the Embedding configuration without a Provider lookup.
- Bad: UI filtering shows only owned Providers, but the Server Action trusts a forged foreign `providerId`.
- Bad: an owner-filtered Embedding dropdown is treated as authorization and a forged `provider_id` is written to `system_settings` before cache invalidation.
- Bad: `testRoute` loads and decrypts the Provider before checking whether the caller may manage the route.

### 6. Tests Required

- Reject foreign Provider IDs in `createModel`, `createRoute`, `updateRoute`, and `attachProviderModelRoute`; assert no model/route mutation.
- Accept an owned Provider for private and manageable public models/routes.
- Exercise `saveEmbedding` through the real owner resolver and settings service: accept owned, reject foreign and missing with the same error while preserving prior settings, and keep exact-empty clear behavior.
- On rejected Embedding saves, assert no cache reset or page revalidation occurs; the test must fail if either the Server Action check or the shared `id + ownerUserId` query predicate is removed.
- Reject probing another owner's private route before key parsing, upstream probe, `recordSuccess`, or `recordFailure`.
- Keep positive probe coverage for own private and manageable public routes.

### 7. Wrong vs Correct

```typescript
// Wrong: a valid admin session or owner-filtered dropdown does not authorize a submitted Provider ID.
const [provider] = await db.select().from(s.providers)
  .where(eq(s.providers.id, providerId));

// Correct: resolve owned Provider and hide foreign-resource existence.
const [provider] = await db.select().from(s.providers)
  .where(and(
    eq(s.providers.id, providerId),
    eq(s.providers.ownerUserId, admin.id),
  ));
if (!provider) throw new Error("服务商不存在");
```

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
- `gateway-execution` engine 拿到 `routes[]` 后逐路由故障转移 × 路由内逐 key 重试,对 operation 与 `source` 透明。

## Scenario: Route-Level Tool Capability

### 1. Scope / Trigger

Apply this contract when changing function tools, MCP tools, WebChat logical search,
Hosted Search, route forms, or route resolution. A catalog model may support tools
while a concrete OpenAI-compatible/2API route does not preserve tool-call events.

### 2. Signatures

- Database: `routes.supports_tools boolean NOT NULL DEFAULT false`.
- Runtime: `ResolvedRoute.supportsTools?: boolean`.
- Effective capability: `model_catalog.capabilities.tools === true && route.supportsTools === true`.

### 3. Contracts

- `model_catalog.capabilities.tools` is the model-level upper bound; it never proves that
  a concrete route supports tools.
- Every route must explicitly opt in with `supports_tools=true`. Missing and migrated
  legacy values are conservative `false`; do not infer support from model/provider names,
  base URLs, or `openai-compatible` protocol alone.
- WebChat exposes its logical `web_search` only when the visible model has at least one
  enabled Provider route whose model and route capabilities both allow tools.
- A request carrying tools rejects a route whose effective capability is false before the
  upstream request, then lets the shared gateway engine try the next route.
- Hosted Search runtime construction and search-model candidate listing apply the same
  route opt-in. This prevents a 2API route from receiving provider-executed search tools.
- Route create/update actions own the persisted flag. Quick-attach and initial-model routes
  keep the database default until a user verifies and enables tool support.

### 4. Validation & Error Matrix

| Catalog tools | Route supports tools | Result |
| --- | --- | --- |
| false/missing | either | Do not expose or send tools |
| true | false/missing | Reject this route for tool-bearing requests; try the next route |
| true | true | Send the normalized ToolSet to this route |
| true | no enabled capable route | WebChat does not inject logical search |
| Hosted Search format compatible | route false | Exclude candidate/runtime |

### 5. Good / Base / Bad Cases

- Good: a model has a 2API primary route with `supports_tools=false` and a verified native
  backup with `true`; a tool request skips the primary and uses the backup.
- Base: an old route migrates to `false` and continues serving ordinary text generation.
- Bad: copying `model_catalog.capabilities.tools` onto every resolved route causes a
  JSON-looking tool call to arrive as assistant text.

### 6. Tests Required

- Migration tests assert the non-null `false` default plus journal/snapshot continuity.
- Route action tests assert checked and unchecked form values persist `true` and `false`.
- Routing tests assert `ResolvedRoute.supportsTools` preserves each row's value.
- Stream tests place an unsupported route before a supported route and assert only the
  supported route reaches `streamText`.
- Web Search candidate and Hosted Search runtime tests assert route opt-in is mandatory.

### 7. Wrong vs Correct

```typescript
// Wrong: model semantics are treated as proof for every upstream route.
tools: route.capabilities?.tools ? toModelTools(request.tools) : undefined;

// Correct: model support is an upper bound and the concrete route must opt in.
selectAdapter: (route) => request.tools?.length
  && !(route.capabilities?.tools === true && route.supportsTools === true)
  ? null
  : adapter;
```

## Scenario: Unified Gateway Execution Engine

### 1. Scope / Trigger

修改 Chat stream/generate、Image、TTS、STT 的上游执行或增加新模态时适用。route resolution 仍由本文件前述 resolver 拥有；engine 只消费有序 route chain。

### 2. Signatures

- `executeGateway<TEvent, TResult>(options): AsyncGenerator<TEvent, GatewayExecutionOutcome<TResult>, void>`
- `GatewayOperation = "chat.stream" | "chat.generate" | "image.generate" | "audio.speech" | "audio.transcription"`
- `selectAdapter(route): GatewayAttemptAdapter | null`
- Media protocol registry：Image 支持 `openai | openai-compatible | openai-images`；TTS 支持 `openai | openai-compatible | openai-audio-tts`；STT 支持 `openai | openai-compatible | openai-audio-stt`。

### 3. Contracts

- Engine 独占 route/key 遍历、尝试上限、retry/failover、breaker、Abort、commit 与 attempt/final telemetry 顺序；调用方和 adapter 不得重建循环。
- AI SDK/provider 内建 retry 必须关闭 (`maxRetries: 0`)。
- Adapter 只构造协议请求并翻译事件/结果。它可在 engine 安全域内接收 raw `ResolvedRoute` 和 API key，但不得写 telemetry 或 breaker。
- Engine 在持有 key/header/base URL 时分类并脱敏 raw error；安全域外只允许 `SafeGatewayError`、无凭据 `GatewayRouteSnapshot` 与 masked key。
- `selectAdapter(route) === null` 产生 rejected attempt，不更新 breaker，并在未 commit 时继续下一 route。
- 可转移错误先 `recordFailure(providerId)`；确定性请求/配置错误不更新 breaker。成功调用 `recordSuccess(providerId)`。
- Abort 不 retry、不 failover、不记 provider failure；所有 operation 统一收敛为 interrupted outcome。
- Chat Agent 多轮仍在 engine 外编排，但共享一个 telemetry session，attempt 全局递增且 execution 只 finalize 一次。

### 4. Validation & Error Matrix

| Condition | Engine action | Breaker / outcome |
|---|---|---|
| Key auth/transient failure before commit | Next weighted key, then next route | Failoverable error records failure |
| Unsupported protocol | Record rejected, continue route | No breaker failure |
| Deterministic request error | Stop | No breaker failure; failed |
| Abort | Stop immediately | No breaker failure; interrupted |
| Success | Stop | Record success; success |
| Failure after committed event | Stop, retain emitted events | Record failure only when failoverable |

### 5. Good / Base / Bad Cases

- Good: Image route A fails before response visibility and route B succeeds with the same OpenAI-compatible response contract.
- Base: one route/one key succeeds and produces one attempt plus one final execution.
- Bad: TTS/STT selects `routes[0]` or forces OpenAI protocol regardless of the route.
- Bad: an adapter catches an upstream error, logs it, and starts its own fallback loop.

### 6. Tests Required

- Engine contract matrix covers key/route fallback, rejected protocols, deterministic failures, Abort, breaker and telemetry ordering.
- Every media adapter covers first-key and first-route failure followed by success, all protocols, all-incompatible routes, and redaction.
- Chat tests cover stream/non-stream parity plus text/reasoning/tool-call commit.
- Route tests preserve `/v1/*` OpenAI SDK wire response and error envelope.

### 7. Wrong vs Correct

```typescript
// Wrong: a modality silently truncates the ordered route chain.
return invoke(routes[0], routes[0].provider.keys[0]);

// Correct: the modality supplies one-attempt translation to the shared engine.
return executeGateway({ resolveRoutes, selectAdapter, telemetry, breaker });
```

## Scenario: 流式响应提交后的故障转移边界

### 1. Scope / Trigger

修改 engine 的 key 重试、路由故障转移或 Chat `StreamEvent` adapter 时，必须保持本节契约。目标是只在客户端尚未收到不可撤回事件时执行完整请求重试，防止同一条流拼接多个上游的内容。

### 2. Signatures

- `executeGateway<StreamEvent, ChatResult>(options): AsyncGenerator<StreamEvent, GatewayExecutionOutcome<ChatResult>, void>`
- 不可撤回事件：`text-delta`、`reasoning-delta`、`tool-call`
- `isRetryableForKey(err: unknown): boolean`
- `isFailoverableError(err: unknown): boolean`

### 3. Contracts

- engine 为每次请求维护单向的响应提交状态；不可撤回事件必须在向调用方 `yield` 前置为已提交。
- 响应未提交时，继续按既有规则尝试同 Provider 的后续 key 和下一条 route。
- 响应已提交后，当前尝试发生任何非 Abort 错误都不得再调用其他 key 或 route；向调用方保留已输出事件并追加现有脱敏 `generation_failed` error 事件。
- 已提交失败仍记录 failed attempt。错误可转移时仍先 `recordFailure(providerId)`，再停止路由循环；禁止故障转移不能跳过失败审计或 breaker 更新。
- Abort 继续直接收敛为 interrupted，不写普通失败事件、不重试、不转移。
- `finish` 是成功终态；`tool-result` 由 Agent loop 在已完成的 `streamChat` 步骤之外产生，不参与单次上游尝试的提交判定。
- 不使用 TTFT 的 `firstTokenAt` 代替提交状态，因为 tool-call 也不可撤回但不是文本 token。

### 4. Validation & Error Matrix

| 条件 | key / route 行为 | 终态与审计 |
|---|---|---|
| 未输出不可撤回事件，key 可重试且仍有 key | 尝试下一 key | 当前 attempt 记 failed |
| 未输出不可撤回事件，错误可转移且仍有 route | 记录 provider 失败后转移 | 当前 attempt 记 failed |
| 已输出 text/reasoning/tool-call 后发生非 Abort 错误 | 不再调用其他 key 或 route | 当前 attempt 记 failed；可转移错误更新 breaker；流以 error 结束 |
| 已输出后发生确定性请求错误 | 不再调用其他 key 或 route | 当前 attempt 记 failed；不更新 breaker；流以 error 结束 |
| 任意阶段 Abort | 不重试、不转移 | interrupted；不发普通 error |
| 上游正常 finish | 不重试、不转移 | success，记录终态 usage |

### 5. Good / Base / Bad Cases

- Good：首路由先输出 `foo` 后超时，客户端收到 `foo` 和 error；备用路由未调用，provider 失败仍进入 breaker。
- Base：首路由在任何 delta 前连接失败，系统继续切到备用路由并正常完成。
- Bad：首 key 输出 `foo` 后失败，第二 key 重新执行完整 messages 并输出 `bar`，客户端最终得到来源混杂的 `foobar`。

### 6. Tests Required

- `stream-circuit-breaker.test.ts`：分别用 text-delta、reasoning-delta、tool-call 触发响应提交，随后抛可转移错误；断言第二路由未调用、事件以脱敏 error 结束、attempt 日志与 breaker 仍更新且无 success 日志。
- 同文件配置一个 Provider 的两把 key，断言首 key 已输出后 `streamText` 只调用一次。
- 保留反向用例：首 key / route 在不可撤回事件前失败时，后续 key / route 仍调用并可成功 finish。

### 7. Wrong vs Correct

```typescript
// Wrong:只看错误类型和候选数量,已输出内容后仍会拼接另一上游。
if (hasMoreAttempts && isRetryableForKey(err)) continue;
if (i < routes.length - 1 && isFailoverableError(err)) continue;

// Correct:输出前提交响应;失败审计和 breaker 更新照常执行,仅禁止后续上游。
if (ev.type === "text-delta" || ev.type === "reasoning-delta" || ev.type === "tool-call") {
  responseCommitted = true;
}
yield ev;

if (!responseCommitted && hasMoreAttempts && isRetryableForKey(err)) continue;
const failoverable = isFailoverableError(err);
if (failoverable) recordFailure(route.provider.id);
if (responseCommitted || !failoverable || i === routes.length - 1) break;
```

## Scenario: 熔断状态机与失败上报

### 1. Scope / Trigger

修改 `circuit-breaker.ts` 状态转换，或修改 gateway engine 的路由失败处理时，必须保持本节契约。目标是防止 half-open 并发探测冲击刚恢复的 provider，并确保终端路由失败也能更新健康状态。

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
- Gateway engine 必须先判断错误是否可转移；若可转移，先 `recordFailure`，再判断是否存在下一条路由。
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
- `src/lib/gateway-execution/`(统一执行状态机、policy、telemetry 与 media registry)。
- `src/lib/stream.ts`(Chat 协议 adapter + byId/byName 分流 + Agent loop)。
- `src/lib/providers/multimodal/`(Image/TTS/STT 协议 adapter)。
- `src/lib/circuit-breaker.ts`(熔断,按 `provider.id`)。
- `src/lib/routing.test.ts`(网关 owner-only + byId 可见性 + 子 key 绑定单测)。
- `src/lib/providers/multimodal/image-gen.test.ts`(图像 byId 可见性 + 网关 owner-only 回归防护)。
