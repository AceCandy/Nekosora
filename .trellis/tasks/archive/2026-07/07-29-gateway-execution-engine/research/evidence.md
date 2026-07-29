# Gateway Execution Evidence

## Hot Paths

- `src/lib/stream.ts:262-363`: `streamChat` route/key loop, response commit, retry/failover and breaker updates.
- `src/lib/stream.ts:624-773`: `generateChat` duplicates route resolution, key ordering, retry/failover, breaker, usage and metrics.
- `src/lib/providers/multimodal/image-gen.ts:65-95`: resolves a route chain but uses only `routes[0]` and one key.
- `src/lib/providers/multimodal/audio-tts.ts:52-63`: uses only `routes[0]` and forces the OpenAI provider.
- `src/lib/providers/multimodal/audio-stt.ts:44-53`: same first-route/OpenAI-only behavior as TTS.
- `src/lib/routing.ts:37-51`: each `ResolvedProvider` already contains both weighted `keys` and a legacy selected `apiKey`.
- `src/lib/providers/keys.ts:95-115`: `orderedWeightedKeys` is the existing weighted, without-replacement attempt order.

## Existing Contracts

- `.trellis/spec/backend/gateway-routing.md`: owner-only/by-id visibility, key binding, route order, commit-before-yield, breaker sequencing.
- `.trellis/spec/backend/error-handling.md`: OpenAI-style error envelope, cancellation and exact credential redaction.
- `.trellis/spec/backend/logging-guidelines.md`: current split usage/error audit model and logical-request metric rules.
- `.trellis/spec/backend/model-message-boundary.md`: both Chat generation paths must consume `separateSystem` output.
- `.trellis/spec/backend/database-guidelines.md`: append-only PostgreSQL migrations and synchronized Drizzle journal/snapshot.

## Protocol Matrix Evidence

- `src/db/schema/pg.ts:139-148` defines `openai`, `anthropic`, `gemini`, `openai-compatible`, `openai-images`, `openai-audio-stt`, `openai-audio-tts`.
- `src/lib/providers/registry.ts:53-106` handles the four Chat protocol families.
- Existing media adapters construct OpenAI providers directly and do not dispatch on media-specific protocols.

## Observability Consumers

- Schema: `src/db/schema/pg.ts:879-968` (`usage_logs`, `ops_error_logs`).
- Writes: `src/lib/usage.ts`, `src/lib/stream.ts`, and route-level failure helpers under `src/app/v1/**/route.ts`.
- Queries: `src/lib/usage-aggregate.ts`, `src/lib/repositories/error-log-repository.ts`.
- UI: `src/app/(dash)/panel/usage/page.tsx`, admin usage tables, `src/app/(dash)/admin/operations/page.tsx`.
- Metrics: `src/lib/infra/metrics.ts`, `src/app/metrics/route.ts`, `scripts/smoke/metrics.smoke.ts`.

## Test Surface And Gaps

- `src/lib/stream-circuit-breaker.test.ts`: current Chat breaker, failover, key retry, redaction and partial commit behavior.
- `src/lib/stream-agent-loop.test.ts`: Agent loop runId, usage aggregation, tool events and terminal behavior.
- `src/lib/providers/multimodal/image-gen.test.ts`: lacks two-route/two-key failover coverage.
- `src/lib/providers/multimodal/audio-adapters.test.ts`: only exercises a single OpenAI route.
- Route tests under `src/app/v1/` characterize public wire responses and route-level error logging.
- Missing shared policy contract matrix across atomic and streaming adapters.
- Missing reasoning-only/tool-call-only commit failure tests.
- Missing media adapter incompatibility followed by a compatible fallback route.

## Migration Constraint

The repository currently has `drizzle/pg/0000_baseline.sql` plus its snapshot/journal. Add `0001`; do not rewrite the baseline. The user explicitly permits dropping data only from `usage_logs` and `ops_error_logs` because the product is not deployed.
