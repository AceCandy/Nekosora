# Web Search Guidelines

## 1. Scope / Trigger

Apply this contract when changing authenticated WebChat search, user search settings,
hosted model search, external search providers, search SSE events, or search history
projection. The authoritative implementation is under `src/lib/web-search/`, with
WebChat wiring in `src/lib/chat/completion-coordinator.ts` and `/api/chat`.

## 2. Signatures

- `SearchBackend`: `{ type: "current-model" } | { type: "model"; modelId } | { type: "provider"; providerId }`.
- Route capability: `routes.supports_tools`; logical and Hosted Search require both catalog
  tool support and an explicitly verified route.
- `WebSearchConfig`: `{ version: 2; providers; backends }`; array order is global user priority.
- `SearchTimeRange`: `{ preset: "week" | "month" | "custom"; startDate: "YYYY-MM-DD"; endDate: "YYYY-MM-DD" }`.
- `searchWeb(userId, query, options): Promise<SearchBundle>` executes the ordered backend list; `options.timeRange` is optional.
- `createExaProvider(apiKey): SearchProvider` sends `POST https://api.exa.ai/search` with `x-api-key`; its request body uses `numResults` in `1..100` and `contents.highlights.maxCharacters = 600`.
- `listWebSearchModelCandidates(userId)` returns visible, enabled models with a compatible enabled route and explicit `model_catalog.capabilities.webSearchFormat`.
- Main-model tool: `web_search({ query, freshness?, dateAfter?, dateBefore? })`; `freshness` is `week | month`, while explicit dates must be a complete inclusive pair and are mutually exclusive with freshness.
- The tool schema description must explicitly tell the main model that `freshness` and `dateAfter/dateBefore` are mutually exclusive, because many models otherwise try both after deriving exact dates from a relative request.
- Search SSE: `search_started`, `search_completed`, `search_failed`, all keyed by `toolCallId`.
- Chat projection: `ChatMessage.searchBackends?: WebSearchTraceBackend[]`, deduplicated by backend type/id.
- Per-call UI projection: `ToolCallRecord.searchBackend?: WebSearchTraceBackend` and `statusDetail?: string`, joined by `toolCallId` rather than tool name or array position.
- Per-call search fallback projection: `ToolCallRecord.searchAttempts?: Array<{ backend; outcome }>` preserves the ordered, display-safe backend attempts; the UI must prefer this chain over the final aggregate reason.
- Backfill command: `pnpm backfill:web-search-keys` is dry-run; add `--apply` for a transactional write.

Required environment:

- `DATA_ENCRYPTION_KEY` encrypts provider API keys with the shared AES-256-GCM helper.
- SearXNG `baseUrl` must be a public HTTP/HTTPS endpoint.

## 3. Contracts

- WebChat keeps one web toggle. `false` exposes no logical search tool. `true` lets a
  tool-capable main model decide whether to call `web_search` and which query to use.
- The main model never chooses Tavily, SearXNG, GPT, Claude, Gemini, or Grok directly.
  `searchWeb` resolves the user's ordered list and falls through unavailable or failed entries.
- Multiple logical `web_search` calls emitted in the same model step run concurrently in stable
  batches of at most three. Each call keeps its own ordered backend fallback chain. Mixed batches
  containing MCP or other tools remain serial, and tool results are projected in the model's
  original call order.
- A model backend is eligible only when the catalog explicitly declares one of
  `openai | anthropic | google | xai` and an enabled route/provider implements the matching
  protocol and has `supports_tools=true`: OpenAI -> `openai`, Anthropic -> `anthropic`,
  Google -> `gemini`, xAI -> `openai-compatible`. Never infer capability from a model name,
  provider URL, or compatible protocol alone.
- Hosted search is a nested request that receives no MCP tools and no logical `web_search`.
  It must return a non-empty grounded summary and at least one validated citation. The outer
  main model remains the only final-answer generator.
- Hosted search prompts include the current UTC date and instruct the nested model to prefer
  recent sources and verify publication/update dates for time-sensitive questions. When a requested
  time range cannot be expressed by the native hosted tool, the prompt includes the inclusive UTC
  start/end dates as a best-effort search and source-selection constraint.
- The outer model expresses time intent through structured tool arguments: use `week` for latest/current
  news, `month` for recent information, explicit dates for a user-supplied range, and omit all time
  fields for ordinary queries. The server never guesses freshness from localized query keywords.
- When the effective WebChat search toggle is on, `prepareChatContext` injects the current
  `Asia/Shanghai` calendar date at request time so the outer model can resolve relative expressions
  before choosing tool arguments. The date must never be hard-coded. Ordinary chats with search off
  keep the stable system prompt so this dynamic slot does not invalidate their prompt cache.
- Time-constrained execution is capability-aware. Tavily and Exa support week/month/custom ranges; Exa
  maps the inclusive UTC boundaries to `startPublishedDate` at `T00:00:00.000Z` and
  `endPublishedDate` at `T23:59:59.999Z`. Google
  Hosted Search receives an exact `timeRangeFilter`; SearXNG participates only in month searches.
  OpenAI/Anthropic/xAI Hosted Search still runs without a native time filter and receives the inclusive
  range in its prompt. This is a deliberate best-effort fallback and must not be represented as a hard
  provider filter. External providers such as Bocha and Zhipu remain unsupported when they cannot
  enforce the requested range.
- A week request runs all eligible backends in user order. Only when that pass produces no result or
  has no eligible backend may it run one month pass in the same order. Month and custom requests never
  fall back to unrestricted search. Attempts and tool results record requested/effective
  ranges and whether this week-to-month fallback occurred.
- External Provider results are validated, bounded, HTTP(S)-only, deduplicated, and treated as
  untrusted tool content. Cancellation and the shared deadline must reach the underlying request.
- Exa requests bounded highlights rather than full text or generated summaries. Non-empty highlights
  are trimmed and joined in upstream order with newlines as `SearchResult.snippet`; response fields are
  accepted only after Zod validation.
- `SearchResult.publishedAt` is optional and contains only an upstream-provided, parseable date normalized
  to ISO. Do not infer dates from snippets. Search context, SSE, process trace, continuation, and history
  projection must preserve it when present.
- SearXNG validation runs at save and request time. DNS resolution, fixed-address connection,
  and every redirect hop must remain public; loopback, private, link-local, metadata, single-label,
  credential-bearing, and rebinding targets are rejected.
- Stored V2 provider DTOs contain `apiKeyCiphertext`; client DTOs contain only `hasApiKey`.
  An empty edit key preserves the existing secret. Every Server Action re-authenticates and uses
  the session user as the only owner.
- `ProcessTrace.webSearch.calls` is persisted with the assistant. Successful citations are projected
  for initial history and siblings; version switching replaces tool calls and citations with the
  target version. Tool events use `toolCallId`; missing IDs remain a legacy compatibility path.
- `search_completed.backend` is the authoritative search provenance. Live SSE state and history
  projection must preserve the deduplicated backend identities alongside citations so the UI can
  show which model or external provider actually returned the sources.
- Each `web_search` row owns its provenance or failure detail. Live state applies `search_completed`
  and `search_failed` by `toolCallId`; history merges `ProcessTrace.webSearch.calls` into the matching
  `tool_calls.tool_call_id`. Ordered backend attempts are retained as safe summaries so a later model
  failure cannot hide an earlier Tavily/provider failure. Message-level `searchBackends` remains a
  compatibility aggregate and must never be assigned to the first or any other individual call.
- Historical failure details are display-safe data, not arbitrary persisted errors. Project only the
  fixed messages emitted by current search validation/execution; omit unknown `reason` or
  `errorJson.message/reason` text. Never expose raw provider errors, URLs, credentials, validation
  objects, or full `errorJson` to the client.
- Continue generation appends content to the same assistant, so it must seed the new trace with that
  assistant's existing `webSearch.calls` before new calls are appended. Replacing the array with only
  the continuation run would make live citations disappear after refresh.
- External search cache keys include the normalized time range in addition to user, backend, and query;
  unrestricted, week, month, and custom searches must never share cached results.
- `/v1/chat/completions` and `/v1/responses` never read user search settings or inject search tools.
- V1 config reads remain compatible during migration, but all writes are V2 ciphertext. The backfill
  prints aggregate counts only and never logs user IDs, plaintext, ciphertext, queries, or summaries.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Web toggle is off | No logical search tool, search request, or search lifecycle event |
| Web toggle is on | Inject the request-time `Asia/Shanghai` date; never reuse a date captured at process startup |
| Catalog supports tools but no enabled route opts in | Do not inject logical search |
| Main model does not call the tool | Generate normally without a search request |
| Backend is missing, disabled, invisible, or route-incompatible | Skip it and try the next ordered backend |
| Result has no grounded summary or no valid citation | Treat as failed and fall through |
| Query is invalid | Return `invalid_search_query` plus `请检查 query、freshness 或日期范围组合`; do not call a backend |
| Freshness and explicit dates are combined | Return `invalid_search_query` plus `freshness 不能与 dateAfter/dateBefore 同时使用`; do not call a backend |
| Only one explicit date is supplied or dates are invalid/reversed | Return `invalid_search_query` plus the generic corrective hint before any network request |
| External Provider cannot enforce the requested range | Record an `unsupported` attempt and continue without calling it |
| Hosted model supports search but not a native range filter | Run hosted search with the inclusive range in its prompt |
| Exa returns non-2xx, malformed data, or no usable results | Preserve the provider error semantics and continue the ordered backend fallback |
| Week pass has no result or eligible backend | Run exactly one month pass; report the effective range and fallback |
| Month/custom pass has no result | Fail the constrained search; never retry without a range |
| All backends fail | Return `web_search_failed`; do not claim fresh information |
| Outer signal aborts | Stop the chain and underlying request; persist interrupted/cancelled state |
| SearXNG target or redirect is non-public | Reject before connecting to that address |
| Client submits an unauthorized model ID | Server Action rejects before configuration write |
| SSE ends without terminal/DONE or success without finish | Client protocol error, never success |
| Continue completes without a new search | Preserve the assistant's existing search calls and citations |
| Backfill runs without `--apply` | Read and count only; zero database writes |
| Backfill leaves any V1 row after apply | Exit non-zero and report only the remaining count |

## 5. Good / Base / Bad Cases

- Good: GLM calls one `web_search`; the user's first eligible Grok backend searches, citations return
  to GLM, and GLM writes the final answer.
- Good: two same-name tool calls use different `toolCallId` values and settle independently in live
  state and restored history.
- Good: one failed search displays only its safe reason while a later successful search displays only
  its own backend; refresh preserves both associations.
- Good: an Exa custom-range request sends exact inclusive UTC publication boundaries and returns
  newline-joined highlights without exposing its API key.
- Good: a latest-news call searches week-capable backends first, then records a month fallback when the
  week pass is empty; a Tavily `published_date` survives into the final model's tool context.
- Good: a constrained OpenAI Hosted Search runs with the requested inclusive dates in its prompt while
  sending only the supported `web_search` tool fields upstream.
- Base: current-model hosted search succeeds and the assistant restores the same sources after refresh.
- Good: an interrupted assistant with sources is continued; old and new search calls remain on the same
  message, and refresh restores the same merged citation set shown during streaming.
- Bad: infer that every model containing `gpt`, `claude`, `gemini`, or `grok` supports search.
- Bad: assume an `openai-compatible`/2API route supports function tools because its catalog model does.
- Bad: overwrite an existing assistant's search trace with only the latest continuation run.
- Bad: pre-search every message when the toggle is on or inject search results into the system prompt.
- Bad: append only "latest" to the query and claim a hard freshness guarantee, or invent unsupported
  native date-filter fields for a Hosted Search provider.
- Bad: display the message-level backend aggregate on the first search row, merge calls by tool name,
  or render arbitrary persisted search error text.
- Bad: send plaintext/ciphertext keys to the browser or accept an unvalidated SearXNG internal URL.

## 6. Tests Required

- Config tests: V1 ordering, V2 ciphertext, DTO redaction, backend deduplication, backfill planning.
- Candidate tests: catalog capability, model/catalog/route/provider enabled predicates, visibility,
  protocol compatibility, route tool opt-in, and duplicate-route collapse.
- Provider tests: response schema, URL filtering/deduplication, retry classes, AbortSignal, user cache isolation,
  and Exa endpoint/header, integer `numResults`, bounded highlights, HTTP error, and response mapping.
- Freshness tests: tool argument validation, UTC week/month boundaries, week-to-month single fallback,
  external-provider unsupported zero-network behavior, Hosted Search prompt-range fallback,
  range-specific cache keys, Tavily/SearXNG/Google parameter mapping, Exa UTC publication-boundary
  mapping, and `publishedAt` normalization/preservation.
- Context tests: search-enabled requests receive the request-time `Asia/Shanghai` date; the value is
  generated per request rather than stored as a fixed prompt constant.
- Public HTTP tests: IPv4/IPv6 private ranges, metadata, DNS rebinding, redirect hops, and valid public hosts.
- Hosted search tests: all four runtime translators, route mismatch, no citation failure, route/key failover,
  outer `runId` and `toolCallId` linkage.
- Chat tests: one logical tool, no pre-search, web toggle precedence, SSE event ordering and IDs, backend
  provenance propagation, per-call success/failure details keyed by `toolCallId`, unsafe historical reason
  rejection, all four generation actions, additive continue trace/citations, history refresh, sibling
  projection, and version replacement.
- Agent loop tests: same-step Web Search concurrency capped at three, per-call failure isolation,
  stable tool-result ordering, and serial execution for mixed Web Search/MCP batches.
- Release gate: `pnpm check`, `pnpm test`, `pnpm build`, migration continuity, and `git diff --check`.

## 7. Wrong vs Correct

Wrong:

```ts
if (webSearch) {
  const results = await searchWeb(userId, lastUserMessage);
  system += renderSearchResults(results);
}
```

Correct:

```ts
const webSearchTool = effectiveWebSearch && modelCapabilities.tools
  ? createWebSearchTool(runContext)
  : undefined;
// The main model calls the single tool only when needed; the server owns backend selection.
```

Wrong:

```ts
const supportsSearch = model.name.includes("grok");
```

Correct:

```ts
const format = modelCatalog.capabilities.webSearchFormat;
const eligible = format && isHostedSearchRouteCompatible(format, route.protocol);
```

Wrong:

```ts
if (timeRange && format !== "google") return null;
```

Correct:

```ts
const prompt = buildHostedSearchPrompt(query, new Date(), timeRange);
const runtime = buildHostedSearchRuntime(route, apiKey, userAgent, timeRange);
```

Wrong:

```ts
trace.webSearch = continuationTrace.webSearch;
```

Correct:

```ts
trace.webSearch = {
  calls: [...existingAssistantCalls, ...(continuationTrace.webSearch?.calls ?? [])],
};
```

Wrong:

```ts
const backend = message.searchBackends?.join(", ");
toolCalls[0].statusDetail = persistedError.reason;
```

Correct:

```ts
const call = toolCalls.find((item) => item.toolCallId === event.toolCallId);
call.searchBackend = event.backend;
call.statusDetail = toSafeSearchStatusDetail(persistedError.reason);
```
