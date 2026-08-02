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
- `searchWeb(userId, query, options): Promise<SearchBundle>` executes the ordered backend list.
- `listWebSearchModelCandidates(userId)` returns visible, enabled models with a compatible enabled route and explicit `model_catalog.capabilities.webSearchFormat`.
- Main-model tool: `web_search({ query: string })`; it is the only search tool exposed to the outer model.
- Search SSE: `search_started`, `search_completed`, `search_failed`, all keyed by `toolCallId`.
- Chat projection: `ChatMessage.searchBackends?: WebSearchTraceBackend[]`, deduplicated by backend type/id.
- Backfill command: `pnpm backfill:web-search-keys` is dry-run; add `--apply` for a transactional write.

Required environment:

- `DATA_ENCRYPTION_KEY` encrypts provider API keys with the shared AES-256-GCM helper.
- SearXNG `baseUrl` must be a public HTTP/HTTPS endpoint.

## 3. Contracts

- WebChat keeps one web toggle. `false` exposes no logical search tool. `true` lets a
  tool-capable main model decide whether to call `web_search` and which query to use.
- The main model never chooses Tavily, SearXNG, GPT, Claude, Gemini, or Grok directly.
  `searchWeb` resolves the user's ordered list and falls through unavailable or failed entries.
- A model backend is eligible only when the catalog explicitly declares one of
  `openai | anthropic | google | xai` and an enabled route/provider implements the matching
  protocol and has `supports_tools=true`: OpenAI -> `openai`, Anthropic -> `anthropic`,
  Google -> `gemini`, xAI -> `openai-compatible`. Never infer capability from a model name,
  provider URL, or compatible protocol alone.
- Hosted search is a nested request that receives no MCP tools and no logical `web_search`.
  It must return a non-empty grounded summary and at least one validated citation. The outer
  main model remains the only final-answer generator.
- Hosted search prompts include the current UTC date and instruct the nested model to prefer
  recent sources and verify publication/update dates for time-sensitive questions. This is a
  ranking instruction, not a provider-specific freshness filter.
- External Provider results are validated, bounded, HTTP(S)-only, deduplicated, and treated as
  untrusted tool content. Cancellation and the shared deadline must reach the underlying request.
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
- Continue generation appends content to the same assistant, so it must seed the new trace with that
  assistant's existing `webSearch.calls` before new calls are appended. Replacing the array with only
  the continuation run would make live citations disappear after refresh.
- `/v1/chat/completions` and `/v1/responses` never read user search settings or inject search tools.
- V1 config reads remain compatible during migration, but all writes are V2 ciphertext. The backfill
  prints aggregate counts only and never logs user IDs, plaintext, ciphertext, queries, or summaries.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Web toggle is off | No logical search tool, search request, or search lifecycle event |
| Catalog supports tools but no enabled route opts in | Do not inject logical search |
| Main model does not call the tool | Generate normally without a search request |
| Backend is missing, disabled, invisible, or route-incompatible | Skip it and try the next ordered backend |
| Result has no grounded summary or no valid citation | Treat as failed and fall through |
| Query is invalid | Return a structured tool error; do not call a backend |
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
- Base: current-model hosted search succeeds and the assistant restores the same sources after refresh.
- Good: an interrupted assistant with sources is continued; old and new search calls remain on the same
  message, and refresh restores the same merged citation set shown during streaming.
- Bad: infer that every model containing `gpt`, `claude`, `gemini`, or `grok` supports search.
- Bad: assume an `openai-compatible`/2API route supports function tools because its catalog model does.
- Bad: overwrite an existing assistant's search trace with only the latest continuation run.
- Bad: pre-search every message when the toggle is on or inject search results into the system prompt.
- Bad: send plaintext/ciphertext keys to the browser or accept an unvalidated SearXNG internal URL.

## 6. Tests Required

- Config tests: V1 ordering, V2 ciphertext, DTO redaction, backend deduplication, backfill planning.
- Candidate tests: catalog capability, model/catalog/route/provider enabled predicates, visibility,
  protocol compatibility, route tool opt-in, and duplicate-route collapse.
- Provider tests: response schema, URL filtering/deduplication, retry classes, AbortSignal, user cache isolation.
- Public HTTP tests: IPv4/IPv6 private ranges, metadata, DNS rebinding, redirect hops, and valid public hosts.
- Hosted search tests: all four runtime translators, route mismatch, no citation failure, route/key failover,
  outer `runId` and `toolCallId` linkage.
- Chat tests: one logical tool, no pre-search, web toggle precedence, SSE event ordering and IDs, backend
  provenance propagation, all four generation actions, additive continue trace/citations, history refresh,
  sibling projection, and version replacement.
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
trace.webSearch = continuationTrace.webSearch;
```

Correct:

```ts
trace.webSearch = {
  calls: [...existingAssistantCalls, ...(continuationTrace.webSearch?.calls ?? [])],
};
```
