# Architecture Roadmap Evidence

## Completed Baseline

- Commit `beaeb6f`: unified Gateway execution engine and observability.
- Archived task: `.trellis/tasks/archive/2026-07/07-29-gateway-execution-engine/`.
- Stable boundary: `src/lib/gateway-execution/`; Chat and media adapters consume it.

## Chat Completion

- `src/app/api/chat/route.ts:436-755` currently owns ReadableStream control, heartbeat, event forwarding, message persistence, artifact extraction, memory enqueue, run finalization and terminal SSE.
- `src/app/api/chat/route.ts:742-755` already protects `[DONE]` behind required persistence, but orchestration remains route-local rather than an independent contract module.
- `src/lib/chat/run-lifecycle.ts` owns run/tool persistence primitives; it must remain separate from gateway execution telemetry.
- `src/app/api/chat/route.ts:683-700` sends `memory-extract` directly and records queue failure only to console; durable delivery intent is not represented.

## RAG Processing

- `src/lib/rag/process.ts:31-100` combines claim, lease token, heartbeat and stage mutation.
- `src/lib/rag/process.ts:169-202` combines chunk replacement, final state and lease-loss handling.
- `src/lib/rag/recovery.ts:11-80` separately owns stale scanning and scheduler lifecycle.
- Existing tests: `process.test.ts`, `process.pg.test.ts`, `recovery.test.ts`; they are characterization gates, not a reason to retain the current boundary.

## Worker / Queue

- `src/lib/infra/queue.ts:55-139` owns start/stop, active operations and lazy queue creation.
- `src/worker.ts:16-123` separately owns job registration, two recovery schedulers, signal shutdown and startup rollback.
- Existing `queue.test.ts` and `worker.test.ts` protect start/stop races and reverse shutdown ordering.

## Model Catalog

- `src/lib/sync-pi-models.ts:310-323` casts external `thinkingLevelMap` without full semantic validation.
- `src/lib/sync-pi-models.ts:325-333` keeps old reasoning/vision on upstream downgrade.
- `src/lib/sync-pi-models.ts:645-650` falls back only the map when invariants fail, leaving related fields potentially inconsistent.
- Project rule: `model_catalog` is the only fact source; official model semantics take precedence, while pi may inform compatible thinking formats/maps.

## Chat Composer

- `src/features/chat/components/ChatComposer.tsx:104-112` stores related selection fields independently.
- `src/features/chat/components/ChatComposer.tsx:264-289` persists a combined snapshot from two independent state updaters; each updater captures the other field from render state.
- Rapid card/KB toggles and async response reordering can persist a snapshot older than the latest visible selection.

## Historical Decision

- The user accepts high-risk/high-reward refactoring and requested implementation in recommended order.
- Earlier architecture exploration identified RAG lease, worker lifecycle and catalog sync as high-value candidates.
- The completed Gateway task explicitly deferred Chat message/run/SSE transaction work; repository evidence now places it first because it protects user-visible completion and supplies a durable intent contract consumed by the later worker lifecycle task.
