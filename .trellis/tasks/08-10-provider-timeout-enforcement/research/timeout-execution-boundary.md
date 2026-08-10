# Provider Timeout Execution Boundary

## Confirmed Repository Facts

- `packages/db/src/schema.ts:207-209` and `drizzle/pg/0000_baseline.sql:333-335` already define nullable `connect_timeout_ms`, `read_timeout_ms`, and `stream_idle_timeout_ms` columns without defaults or range constraints.
- `packages/core/src/lib/providers/types.ts:28-32` exposes only `connectTimeoutMs` and `readTimeoutMs`. `packages/core/src/lib/routing.ts:39-52` maps only those two fields, so `streamIdleTimeoutMs` is currently lost before execution.
- `apps/web/src/app/(dash)/panel/actions.ts:156-189,415-448`, `apps/web/src/features/providers/ProviderFormDialog.tsx:15-45`, and `apps/web/src/app/(dash)/panel/providers/page.tsx:47-78` do not read, persist, display, or validate any timeout field.
- `packages/core/src/lib/providers/registry.ts:36-42` wraps `fetch` only to set `user-agent`. Chat, hosted-search, and multimodal Provider construction does not consume the stored timeout fields.
- Provider discovery uses an independent fixed 15-second budget in `packages/core/src/lib/providers/probe.ts:58-64`; hosted web search also has an operation-specific budget. Those budgets currently do not compose with Provider settings.

## Execution And Cancellation Boundary

- `packages/core/src/lib/gateway-execution/engine.ts:115-176` owns each route/key attempt and passes the caller `AbortSignal` to the selected adapter.
- `engine.ts:207-231` classifies caller abort as `interrupted`, records one interrupted attempt, closes the iterator, skips breaker failure, and performs no key or route fallback.
- `engine.ts:234-290` classifies ordinary upstream failures, records the failed attempt, updates the breaker for failoverable failures, and retries only before the response is committed.
- Once an event commits the response (`engine.ts:167-169`), a later timeout must terminate the same stream and must not switch key or route.
- `packages/core/src/lib/gateway-execution/engine.test.ts:36-76` provides the existing attempt/finalization harness. Its abort, unresponsive-adapter, key fallback, route fallback, and committed-response cases are the correct regression boundary.

## Installed SDK Constraints

- The lockfile resolves `ai@7.0.31`, `@ai-sdk/openai@4.0.16`, `@ai-sdk/anthropic@4.0.16`, `@ai-sdk/google@4.0.18`, and `@ai-sdk/openai-compatible@3.0.12`.
- Provider factories accept `fetch?: FetchFunction`, where `FetchFunction` is `typeof globalThis.fetch` (`@ai-sdk/provider-utils/dist/index.d.ts:815`). A shared wrapper can therefore preserve the SDK signal while adding the Provider connection deadline.
- `ai` request options expose `abortSignal`, `maxRetries`, and `timeout`; `TimeoutConfiguration` supports `totalMs` and streaming `chunkMs` (`ai/dist/index.d.ts:591-656`).
- A fetch promise resolves when response headers arrive. Stream bodies are consumed later by the SDK, so racing only `fetch()` cannot enforce total-read or stream-idle timeouts.
- Gateway generation already sets `maxRetries: 0`. Timeout retry and failover must remain owned by `executeGateway`, not by the SDK.

## Design Constraints Derived From The Evidence

1. `connectTimeoutMs` can only mean request dispatch through receipt of response headers with the portable Fetch API; it must not be documented as a pure TCP handshake timer.
2. `readTimeoutMs` should be the total upstream attempt deadline through complete body consumption. `streamIdleTimeoutMs` should be the maximum interval without an upstream stream chunk, reset after each chunk.
3. Provider timeout signals must be distinct from the caller cancellation signal. A Provider timeout is a failed, failoverable `gateway.timeout`; caller cancellation remains `interrupted`.
4. Signal composition must preserve the first cause, remove listeners, clear timers, abort the upstream request, and close/cancel the active iterator or reader exactly once.
5. Existing operation-specific budgets such as Provider discovery remain additional upper bounds; composing budgets means the first deadline wins.
6. Chat's four route formats, hosted Provider search, image, speech, transcription, and Provider discovery must use the same timeout policy rather than local copies.

## Reusable Test Patterns

- `packages/core/src/lib/web-search/hosted-model.test.ts:78-138,199-261`: controllable async stream, fake timers, idle reset, and listener cleanup.
- `packages/core/src/lib/web-search/service.test.ts:101-228`: injected timeout signals and fallback deadline races.
- `apps/gateway/src/server.listener.test.ts:46-98`: protocol table, reader cancellation, and client disconnect cleanup.
- `packages/core/src/lib/protocols/multi-protocol-matrix.test.ts:66-163`: four chat wire-format matrix.
- `packages/core/src/lib/gateway-execution/engine.test.ts:93-128,319-455`: attempt finalization, fallback, committed response, and abort behavior.

## Confirmed Product Policy

- Defaults: connect/response headers `60s`, total read `15min`, stream idle `120s`.
- Allowed ranges: connect `1s..5min`, total read `10s..60min`, stream idle `5s..15min`.
- Blank values resolve to defaults. Zero and negative values are invalid and cannot disable the hard deadline.
