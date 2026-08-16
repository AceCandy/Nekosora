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

## Scenario: 路由排序与熔断
- `orderRoutes(routes)`:priority 升序分组,组内 `weightedShuffle`(按 weight 加权无放回抽取)。
- `filterByCircuitBreaker(routes)` 只读取 Provider availability,保留 `closed`/`probe_ready`,过滤 `open`/`probe_busy`;它不得占用探针。
- 全部路由不健康时抛 `no_healthy_route`,不得返回原全集;对外稳定映射为 `routing.no_healthy_route` / HTTP 503。
- `gateway-execution` engine 在每个 route 前原子获取 Provider permit,再执行路由内 Key fallback;permit 在 route 级 `finally` 释放。
- 熔断 key 固定为 `provider.id`;priority、weight、Key 顺序和 route failover 算法不因熔断契约改变。

## Scenario: Route-Level Tool Capability

### 1. Scope / Trigger

Apply this contract when changing function tools, MCP tools, WebChat logical search,
Hosted Search, route forms, or route resolution. A catalog model may support tools
while a concrete OpenAI-compatible/2API route does not preserve tool-call events.

### 2. Signatures

- Database: `routes.supports_tools boolean NOT NULL DEFAULT true` for new rows. Migration
  The squashed `0000_baseline.sql` sets the fresh-database default to `true`; existing
  pre-squash databases retain their historical row values when their ledger is compacted.
- Runtime: `ResolvedRoute.supportsTools?: boolean`.
- Effective capability: `model_catalog.capabilities.tools === true && route.supportsTools === true`.
- Route form: `supportsToolsPresent=true` means the checkbox was rendered; a checked
  checkbox additionally submits `supportsTools=on`.

### 3. Contracts

- `model_catalog.capabilities.tools` is the model-level upper bound; it never proves that
  a concrete route supports tools.
- New routes default to `supports_tools=true`; an administrator can explicitly save
  `false`, and historical `false` rows remain unchanged. Do not infer support from
  model/provider names, base URLs, or `openai-compatible` protocol alone.
- WebChat exposes its logical `web_search` only when the visible model has at least one
  enabled Provider route whose model and route capabilities both allow tools.
- A request carrying tools rejects a route whose effective capability is false before the
  upstream request, then lets the shared gateway engine try the next route.
- If an opted-in route returns HTTP 400/422 with both a tools-related field
  (`tools`, `tool_choice`, or function calls) and explicit unsupported/forbidden wording,
  the engine records a failed attempt with `tools_not_supported`, conditionally updates
  only that `routeId` from `true` to `false`, skips the route's remaining keys, and tries
  the next route. The update is best effort and never updates the provider breaker.
- When no tool-capable route succeeds and no text, reasoning, or tool-call event was
  committed, `streamChat` retries the request once without `tools`; the retry is never
  repeated and never happens after a committed event. A tool execution error is a tool
  result error, not evidence that the route lacks tool support. Routes are never
  automatically changed from `false` back to `true`.
- Hosted Search runtime construction and search-model candidate listing apply the same
  route opt-in. This prevents a 2API route from receiving provider-executed search tools.
- Route create/update actions own the persisted flag. Quick-attach and initial-model routes
  inherit the database default, while an explicit checkbox still persists `false`.
- A create action with neither form field uses the new `true` default. An update action with
  neither field preserves the stored value; `supportsToolsPresent=true` without
  `supportsTools=on` is the only unchecked-form signal and persists `false`.

### 4. Validation & Error Matrix

| Catalog tools | Route supports tools | Result |
| --- | --- | --- |
| false/missing | either | Do not expose or send tools |
| true | false/missing | Reject this route for tool-bearing requests; try the next route |
| true | true | Send the normalized ToolSet to this route |
| true | no enabled capable route | WebChat does not inject logical search |
| Hosted Search format compatible | route false | Exclude candidate/runtime |

| Upstream result | Required action |
| --- | --- |
| 400/422 + tools field + explicit unsupported/forbidden wording | Mark this route `false` conditionally; skip its remaining keys; continue routes |
| Same error after a visible event | Stop; do not retry or switch routes |
| Ordinary 400, timeout, rate limit, auth, moderation, 5xx | Existing error/failover policy; never mark tool support |
| Tool definition accepted, tool execution fails | Return `tool-result.isError`; never mark tool support |
| Persistence update fails | Keep current request outcome; do not surface the learning failure |

### 5. Good / Base / Bad Cases

- Good: a model has a 2API primary route with `supports_tools=false` and a verified native
  backup with `true`; a tool request skips the primary and uses the backup.
- Base: an old route migrates to `false` and continues serving ordinary text generation.
- Bad: copying `model_catalog.capabilities.tools` onto every resolved route causes a
  JSON-looking tool call to arrive as assistant text.

### 6. Tests Required

- Migration tests assert the historical `false` default, the new `true` default, no update
  statement, and journal/snapshot continuity.
- Route action tests assert omitted create values default to `true`, checked and unchecked
  form values persist `true` and `false`, and omitted update values preserve the stored flag.
- Routing tests assert `ResolvedRoute.supportsTools` preserves each row's value.
- Stream tests place an unsupported route before a supported route and assert only the
  supported route reaches `streamText`.
- Policy tests cover direct and nested AI SDK errors plus ordinary 400/tool execution errors.
- Engine tests assert route-specific conditional re-marking, key skipping, route failover,
  breaker isolation, and persistence failure isolation.
- Agent/stream tests assert one no-tools fallback, no leaked first error, no retry after
  committed output, and no re-marking for tool execution failures.
- Web Search candidate and Hosted Search runtime tests assert route opt-in is mandatory.

### 7. Wrong vs Correct

```typescript
// Wrong: model semantics are treated as proof for every upstream route.
tools: route.capabilities?.tools ? toModelTools(request.tools) : undefined;

// Correct: model support is an upper bound and the concrete route must be enabled.
selectAdapter: (route) => request.tools?.length
  && !(route.capabilities?.tools === true && route.supportsTools === true)
  ? null
  : adapter;

// Correct: only learn from an explicit upstream tools rejection, and only true -> false.
await db.update(routes)
  .set({ supportsTools: false })
  .where(and(eq(routes.id, route.routeId), eq(routes.supportsTools, true)));

// Wrong: an omitted update field silently disables tools.
supportsTools: formData.get("supportsTools") === "on";

// Correct: only a submitted checkbox control changes the stored value.
...(formData.has("supportsToolsPresent") || formData.has("supportsTools")
  ? { supportsTools: formData.get("supportsTools") === "on" }
  : {});
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

## Scenario: OpenAI Chat Inbound Stream Options

### 1. Scope / Trigger

修改 /v1/chat/completions parser、OpenAI Chat 流响应，或排查包含
stream_options 的 400 时适用。入站字段和 Provider adapter 生成的同名出站字段是两个
独立边界，不能用一侧的能力开关代替另一侧的协议解析。

### 2. Signatures

- HTTP：POST /v1/chat/completions。
- Parser：parseChatCompletions(body): ParsedGatewayRequest。
- 入站字段：stream_options?: { include_usage?: boolean }。

### 3. Contracts

- OpenAI Chat parser 允许 stream_options，仅接受可选布尔字段 include_usage。
- 未知子字段抛出 UnsupportedParameterError，参数路径保留为
  stream_options.<field>；类型错误按现有 invalid JSON 契约返回 400。
- stream_options 是调用方到网关的响应控制字段。Parser 消费后不得把它复制进 IR，
  更不得原样透传上游；Provider adapter 是否发送同名字段由下一节的 endpoint 能力独立决定。
- 当前 OpenAI Chat encoder 保持既有最终 usage 输出布局；改成 OpenAI 官方的空
  choices usage 尾帧属于单独的响应兼容任务，不与入口 400 修复捆绑。
- 排障时先看边界证据：没有上游 attempt 且入口错误的 model 为 (unknown)，说明请求在
  parser/auth 边界被拒绝；已有 attempt 才检查 Provider 请求体与出站能力学习。

### 4. Validation & Error Matrix

| Input | Result |
| --- | --- |
| stream: true + stream_options.include_usage=true | 进入 streamChat，不在入口返回 400 |
| include_usage=false 或空对象 | 接受；字段不进入 IR |
| include_usage 非布尔值 | 400 invalid request；不触发上游 |
| stream_options.include_cost | 400 Unsupported parameter: 'stream_options.include_cost'. |
| 其他未知顶层字段 | 保持现有严格 400 行为 |

### 5. Good / Base / Bad Cases

- Good：OpenAI SDK 向网关发送标准 stream_options.include_usage，parser 校验后进入统一 IR。
- Base：未发送 stream_options 的既有客户端行为不变。
- Bad：只给 Provider 增加出站开关，入站 parser 仍在路由执行前拒绝同名字段。
- Bad：把整个入站对象塞进 IR 并透传，导致调用方控制具体上游请求细节。

### 6. Tests Required

- Parser 单测覆盖 true、非布尔类型、未知子字段准确路径，以及 IR 不含该字段。
- /v1/chat/completions 路由测试覆盖有效输入返回 200 并调用 streamChat。
- 路由测试覆盖未知子字段返回 400 且 streamChat 未调用。

### 7. Wrong vs Correct

    // Wrong:只修出站 Provider；请求实际在 parser 就失败。
    createOpenAICompatible({ includeUsage: false });

    // Correct:入站字段在协议边界校验并消费，不进入统一 IR。
    const streamOptions = objectAt(body.stream_options, "stream_options");
    assertAllowed(streamOptions, ["include_usage"], "stream_options");

## Scenario: OpenAI-Compatible Stream Usage Negotiation

### 1. Scope / Trigger

修改 OpenAI-compatible Chat、`includeUsage`、Provider 配置保存、Gateway 重试或
`providers` 能力字段时适用。该能力描述具体上游 endpoint 是否接受
`stream_options`，不属于 model catalog 的模型语义。

### 2. Signatures

- DB：`providers.supports_stream_usage boolean NULL`。
- Runtime：`ResolvedProvider.supportsStreamUsage?: boolean | null`。
- Registry：`includeUsage = provider.supportsStreamUsage !== false`。
- Persistence：`markProviderStreamUsageUnsupported(providerId, baseUrl): Promise<void>`。
- Engine hooks：`isStreamOptionsUnsupported(route, error)`、`onStreamOptionsUnsupported(route)`。

### 3. Contracts

- `null`/`true` 继续发送 `stream_options: { include_usage: true }`；`false` 省略该字段。
- 自动协商只用于流式 `openai-compatible + openai-chat` route；官方 OpenAI、Responses、
  Anthropic、Gemini 与非流式调用不注册降级 hook。
- 仅 HTTP 400 且同一个直接错误或 `lastError` 同时包含 `stream_options` 与明确拒绝语义时学习。
  外层 RetryError 文案不得与无关的嵌套 400 混合匹配。
- 客户端尚未收到正文、推理或工具事件时，先记录 failed attempt，再把当前 Provider
  状态改为 `false`，按 Provider ID + 本次 Base URL best-effort 持久化，随后用同 route、
  同 key 重试一次。整个 execution 最多进行一次这种兼容性重试。
- 第一次兼容性 400 不更新 breaker；重试成功只 finalize 一次 success。重试仍失败时恢复
  既有错误分类、breaker 与 route/key 收敛规则。已提交响应后禁止学习和重试。
- 持久化失败不覆盖当前请求结果；内存状态仍保证本次重试省略该字段。Provider 配置保存
  一律把字段重置为 `null`，让变更后的 endpoint 重新探测；后台不提供手动开关。
- 条件更新必须同时匹配 ID 与 Base URL，防止旧请求在管理员换址后把新 endpoint 标为不支持。

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| 未知能力，上游接受字段 | 单次请求成功，保留流式 usage |
| 400 明确拒绝 `stream_options`，尚未 commit | 记录失败，持久化 `false`，同 route/key 无字段重试一次 |
| 普通 400、其他参数、422 或 5xx | 不学习；走既有错误与故障转移规则 |
| 外层文案命中、嵌套 400 与该字段无关 | 不学习 |
| 明确拒绝发生在 commit 后 | 不学习、不重试，保留已输出事件 |
| 条件持久化零行或抛错 | 当前请求继续使用内存降级；不覆盖业务结果 |
| Provider 保存或换址 | 状态重置 `null`；旧 Base URL 的迟到更新不能命中新行 |

### 5. Good / Base / Bad Cases

- Good：兼容上游首次返回 400，网关用同一 key 省略可选字段后成功；后续进程首发即省略。
- Base：支持 `stream_options` 的上游保持原请求体和 usage 统计。
- Bad：为兼容一个上游全局删除 `includeUsage`，让所有支持方失去流式 usage。
- Bad：按模型名记录该能力，或仅按 Provider ID 更新，导致不同 endpoint 互相污染。

### 6. Tests Required

- Policy 覆盖直接错误、`lastError`、普通 400、其他字段、其他状态码及外层误导文案。
- Registry 断言 `null`/`true` 发送、`false` 省略；routing 保留数据库状态。
- Engine 断言同 route/key 单次重试、整个 execution 不重复、两条 attempt、单次 finalize、
  committed 禁止降级、breaker 隔离和持久化失败隔离。
- `streamChat` 接线测试断言客户端看不到首个 400，且持久化收到准确的 Provider ID/Base URL。
- Migration 测试断言 nullable 列、journal/snapshot 连续；管理 action 测试断言保存重置 `null`。

### 7. Wrong vs Correct

```typescript
// Wrong:所有 compatible 上游永久发送可选字段，且错误后换 key 重复探测。
createOpenAICompatible({ includeUsage: true });

// Correct:读取 endpoint 能力；仅在精确兼容性 400 后同 key 降级一次。
createOpenAICompatible({
  includeUsage: route.provider.supportsStreamUsage !== false,
});
await db.update(providers)
  .set({ supportsStreamUsage: false })
  .where(and(eq(providers.id, providerId), eq(providers.baseUrl, failedBaseUrl)));
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

修改 `circuit-breaker.ts`、路由过滤、gateway engine、错误映射或熔断指标时适用。目标是让路由判断无副作用，由能观察全部终态的 Engine 持有 half-open 探针，并在全部 Provider 不健康时 fail closed。

### 2. Signatures

- `getProviderAvailability(providerId): "closed" | "probe_ready" | "open" | "probe_busy"`
- `acquireProviderPermit(providerId): GatewayBreakerPermit | null`
- `GatewayBreakerPermit.recordSuccess(): void`
- `GatewayBreakerPermit.recordFailure(): void`
- `GatewayBreakerPermit.release(): void`
- `recordSuccess(providerId: string): void`
- `recordFailure(providerId: string): void`
- `recordNoHealthyRoute(): void`

### 3. Contracts

- `closed`：允许请求；连续可转移失败达到 threshold 后转 `open`。
- `open` 冷却未到返回 `open`;冷却已到只返回 `probe_ready`,availability 查询不得改变状态。
- `acquireProviderPermit` 是唯一占用点：`probe_ready -> half-open`,同一 Provider 同时最多一个 probe token;`open`/`probe_busy` 返回 null。
- permit 覆盖一个 route 及其全部 Key fallback。前序 Key 失败但后续 Key 成功时，成功优先并恢复 `closed`;没有成功且出现可转移失败时重新 `open` 并刷新冷却。
- Abort、确定性请求错误、adapter/能力拒绝、空 Key、Provider-start 失败属于中性终态：不判健康、不增加失败，probe release 后回到 `open` 并保留已到期的 `openUntil`,允许下一请求立即竞争。
- permit `release()` 必须幂等并校验 token;迟到的旧 permit 不得结算新的 half-open 探针。管理员 route probe 继续使用公开 `recordSuccess/recordFailure`。
- 路由快照全部为 `open/probe_busy`，或 Engine 竞争窗口中所有 acquire 均失败时，禁止调用 adapter，返回 `routing.no_healthy_route` / HTTP 503，且不增加伪造 attempt。
- Prometheus 仅记录 `nekusora_gateway_circuit_breaker_events_total{event}`。`event` 固定为 `no_healthy_route|probe_acquired|probe_succeeded|probe_failed|probe_released`,禁止 Provider/route/model/request/Key 标签。
- 不返回 `Retry-After`;`probe_busy` 没有可靠完成时间。进程内 Map 仍是熔断边界，不引入跨实例协调。

### 4. Validation & Error Matrix

| 条件 | permit / breaker | 执行与错误 |
|---|---|---|
| `closed` | 获取普通 permit | 保持现有 Key/route 顺序 |
| `open` 且冷却未到 | acquire 拒绝 | 跳过 Provider |
| `open` 且冷却到期 | 单个 acquire 转 `half-open` | 仅一个恢复探针执行 |
| `probe_busy` | acquire 拒绝 | 使用健康备用;无备用则 503 |
| 探针最终成功 | `half-open -> closed`,失败计数清零 | 返回成功 |
| 探针可转移失败/Provider timeout | `half-open -> open`,刷新冷却 | 按既有规则 failover |
| 探针中性终态 | `half-open -> open`,保留到期时间 | 不新增健康或失败事实 |
| 全部 acquire 拒绝 | 记录一次 `no_healthy_route` | 零 adapter/attempt,稳定 503 |

### 5. Good / Base / Bad Cases

- Good：多个请求在冷却边界并发到达，只有一个 Engine 获得 probe permit;其他请求走健康备用或立即 503。
- Good：同一 probe 的首 Key 503、次 Key 成功，最终 Provider 恢复 `closed`。
- Base：普通 closed Provider 成功后保持 closed;可转移失败按 route 结算一次。
- Bad：路由解析调用会占用探针的 boolean API，随后 Abort/拒绝路径无法释放所有权。
- Bad：全部 Provider 被拒绝后返回原路由全集，重新冲击已 open 的上游。

### 6. Tests Required

- `circuit-breaker.test.ts`:纯 availability、单 token、成功优先、失败重开、中性 release、迟到/重复 release、多 Provider 隔离。
- `routing.test.ts`:部分熔断保留健康 Provider;全 open/probe busy 抛 `no_healthy_route`,不返回原全集。
- `gateway-execution/engine.test.ts`:acquire 竞争、Key fallback，以及 success/failure/timeout/Abort/确定性错误/adapter 拒绝/空 Key/Provider-start 的 release。
- `stream-circuit-breaker.test.ts`:Chat stream/generate 全熔断时 adapter 调用与 attempt 均为 0;真实 half-open 中性终态可立即重探。
- 错误、i18n、protocol encoder、Image/TTS/STT route 与 metrics tests 断言点分码、HTTP 503、原生 envelope 和固定低基数标签。

### 7. Wrong vs Correct

```typescript
// Wrong:路由解析阶段占用探针;全拒绝又返回原全集。
const allowed = routes.filter((route) => isProviderAllowed(route.provider.id));
return allowed.length > 0 ? allowed : routes;

// Correct:路由只读 availability,Engine 获取并可靠释放所有权。
const permit = breaker.acquire(route.provider.id);
if (!permit) continue;
try {
  await executeRouteWithKeyFallback(route, permit);
} finally {
  permit.release();
}
```

## Scenario: Route-Level Wire Format And Multi-Protocol Gateway

### 1. Scope / Trigger

修改 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、Gemini
GenerateContent、route 表单/迁移、Provider registry 或协议 parser/encoder 时适用。

### 2. Signatures

- DB：`routes.api_format route_api_format NOT NULL`。
- Runtime：`ResolvedRoute.apiFormat?: RouteApiFormat`。
- Registry：`buildLanguageModelWithKey(route, apiKey, cacheKey?, reasoning?, userAgent?)`。
- HTTP：`handleProtocolRequest(request, ingressProtocol, requestPath, parser)`。
- Chat wire formats：`openai-chat | openai-responses | anthropic-messages | gemini-generate-content`。

### 3. Contracts

- 数据流固定为 `ingress parser -> IRRequest -> executeGateway -> route apiFormat adapter -> StreamEvent -> ingress encoder`；入口协议不得影响 route 选择。
- 普通聊天的上游 wire format 只读 route `apiFormat`。Provider `protocol` 仅用于新 route 默认值、Provider `/models`/key 探测和 OpenAI 官方/compatible Chat 差异。
- `model_catalog` 是模型类型、能力、推理语义和档位的唯一事实源；不得按模型名、Provider 名、Base URL 或入口路径猜测。
- route 深度探测必须把 route `apiFormat` 传给同一个 registry；Provider 模型列表仍按 Provider `protocol`。
- 上游 SDK 调用固定 `maxRetries: 0`；retry、Key 轮换、route 故障转移、breaker 和 telemetry 由 `executeGateway` 独占。
- Responses adapter 和深度探测显式发送 `providerOptions.openai.store=false`，避免无状态网关在上游创建持久对象。
- 自定义认证头先过滤 `authorization`、`x-api-key`、`x-goog-api-key`，再由目标 adapter 注入原生凭据。
- 文本、推理或工具事件提交后不得切换 Key/route；Abort 不 retry、不 failover、不更新普通 Provider failure。

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Route format can express the IR request | Build that SDK adapter and execute once |
| Route format cannot express a parameter | Record rejected attempt, do not fetch or update breaker, continue route |
| All routes are rejected | Return ordered first `request.unsupported_parameter` as HTTP 400 |
| Client aborts before/during generation | Interrupt current attempt; no retry, failover, success terminator, or ordinary failure |
| OpenAI-compatible Provider route selects Responses/Anthropic/Gemini | Use route format endpoint and native auth, not Provider protocol |
| Chat operation receives a media apiFormat | Reject before upstream; media registry remains operation-specific |

### 5. Good / Base / Bad Cases

- Good：客户端用 `/v1/responses` 调 Claude route；上游发 `/messages`，结果再编码为 Responses。
- Base：OpenAI Chat ingress + `openai-chat` route 保持既有 JSON/SSE、usage 和 `[DONE]`。
- Bad：用 `provider.protocol` 决定普通聊天 endpoint，使同 Provider 下多格式 route 全部走同一种协议。
- Bad：Responses 上游省略 `store:false`，客户端虽无状态但上游仍持久化响应。

### 6. Tests Required

- 真实 parser、encoder、engine、registry 和 AI SDK 的 4 ingress x 4 egress 矩阵；断言 endpoint、认证头、协议请求体、入口响应和 telemetry。
- route probe 使用真实 registry，至少断言四种生成 endpoint、原生认证头及 SDK 网络错误只请求一次。
- 五个 HTTP 路径的 listener 取消测试，加四种 encoder 到 `streamChat.abortSignal` 的传播测试。
- engine 分别以文本、推理和工具事件提交后失败，断言第二 Key/route 未调用；Abort 断言 breaker 不更新。
- DB migration、admin/panel action、repository/routing 和媒体格式回归测试必须同时存在。

### 7. Wrong vs Correct

```typescript
// Wrong: Provider 连接类型被当成 route wire format。
const model = provider.protocol === "anthropic"
  ? createAnthropic(...).messages(route.upstreamModelName)
  : createOpenAI(...).chat(route.upstreamModelName);

// Correct: route 保存并决定实际 wire format；Provider protocol 仅提供连接语义。
const apiFormat = resolveRouteApiFormat(route);
return buildLanguageModelWithKey({ ...route, apiFormat }, apiKey);
```

---

## Scenario: Protocol-Native Model Discovery

### 1. Scope / Trigger

修改 `GET /v1/models`、入口 Key 解析、模型列表字段或客户端协议兼容时适用。
模型生成协议兼容必须包含客户端发现阶段；只验证 `/v1/messages` 等生成端点不算完整兼容。

### 2. Signatures

- HTTP：`GET /v1/models?limit=&after_id=&before_id=`。
- 协议选择：存在 `x-api-key` 或 `anthropic-version` 请求头时使用 Anthropic；否则保持 OpenAI。
- OpenAI：`{ object: "list", data: [{ id, object, created, owned_by }] }`。
- Anthropic：`{ data: [{ id, created_at, display_name, type }], first_id, has_more, last_id }`。

### 3. Contracts

- 入口统一复用 `authenticateGatewayRequest`。OpenAI 接受 Bearer；Anthropic 接受 `x-api-key` 或 Bearer；两种 Key 同时存在且值不一致时返回原生 401。
- 协议选择只改变认证头、错误 envelope 和成功响应，不改变模型集合。主 Key 只列 owner 的 enabled 模型；子 Key 还必须命中 `key_model_bindings`。
- OpenAI 响应保持既有兼容结构。Anthropic `display_name` 使用模型显示名，空值回退对外模型 ID；目录没有可靠发布日期时 `created_at` 使用 RFC 3339 epoch，不伪造发布日期。
- Anthropic 默认 `limit=20`，合法范围 `1..1000`；`after_id` 与 `before_id` 互斥。分页前按模型 ID 的固定代码点顺序排序，禁止使用依赖运行环境 locale 的比较器。
- `after_id` 向后取页，`before_id` 反向取其前一页。空页返回 `data=[]`、`first_id=null`、`last_id=null`、`has_more=false`。
- 未知查询参数返回原生 400 `Unsupported parameter`；重复、空或越界值返回 Anthropic `invalid_request_error`，且这些语法校验失败不得查询模型数据。未知 cursor 在读取当前 Key 的可见模型集后返回同类 400。
- `model_catalog` 仍是能力和 token 上限的唯一事实源。列表不得从模型名猜测 Anthropic 新增 capability 字段；目录尚未表达的字段应省略，而不是伪造。

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Bearer，无 Anthropic 标记 | OpenAI 列表与 OpenAI 错误 envelope |
| `x-api-key` 或 `anthropic-version` | Anthropic 列表与 Anthropic 错误 envelope |
| Bearer 与 `x-api-key` 相同 | 接受并按 Anthropic 返回 |
| Bearer 与 `x-api-key` 不同 | HTTP 401；不查询数据库 |
| 子 Key 绑定外的模型 | 不出现在任一协议列表 |
| 合法 limit/cursor | 稳定分页并返回正确 cursor 元数据 |
| 未知参数或语法非法值 | HTTP 400；不查询模型数据 |
| cursor 不在当前可见模型集 | 读取可见模型后 HTTP 400，不泄露其他用户模型 |

### 5. Good / Base / Bad Cases

- Good：Anthropic SDK 用 `x-api-key` 调 `/v1/models`，解析原生分页后再调用 `/v1/messages`。
- Base：现有 OpenAI SDK 用 Bearer 获取原有 `{ object: "list" }` 响应，不受 Anthropic 兼容影响。
- Bad：只让 `/v1/messages` 接受 `x-api-key`，模型列表仍要求 Bearer，导致客户端在生成前失败。
- Bad：用 `localeCompare` 排序 cursor，多个 locale 不同的 Gateway 副本返回不同分页顺序。

### 6. Tests Required

- 路由测试覆盖 `x-api-key`、`anthropic-version + Bearer`、冲突 Key 与 OpenAI Bearer 回归。
- 主/子 Key 测试必须断言 owner、enabled 和 binding 查询谓词，不能只给 mock 预过滤结果。
- 覆盖默认/边界 limit、after/before、空页、未知 cursor、互斥/重复/未知参数；仅语法和未知参数失败断言发生在 `getDb()` 前。
- 真实 Gateway HTTP 探测至少证明 `x-api-key` 进入 Anthropic 鉴权，而不是返回“缺少 Authorization: Bearer”。

### 7. Wrong vs Correct

```typescript
// Wrong：发现接口仍被固定成 OpenAI Bearer，生成接口兼容也无法被客户端使用。
const rawKey = extractBearer(request.headers.get("authorization"));
return Response.json({ object: "list", data: models });

// Correct：先由原生请求头选择入口协议，再复用共享鉴权并编码对应列表。
const anthropic = request.headers.has("x-api-key")
  || request.headers.has("anthropic-version");
const ctx = await authenticateGatewayRequest(
  request,
  anthropic ? "anthropic" : "openai-chat",
);
return anthropic ? anthropicModels(models) : openAIModels(models);
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
