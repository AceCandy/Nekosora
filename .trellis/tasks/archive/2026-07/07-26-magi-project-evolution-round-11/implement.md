# Implementation Plan

1. Add failing queue unit tests for concurrent adapter construction, ordered start/create/send, same-name create deduplication, failure retry and null job id rejection.
2. Add failing readiness route tests for healthy DB+queue and queue false/reject/timeout returning 503 while preserving diagnostic JSON.
3. Refactor `src/lib/infra/queue.ts` to use adapter/start/per-name promises and make `send`/`work` ensure their prerequisites.
4. Make `queueAvailable()` await real startup; update readiness to require both DB and queue; add safe observability for memory enqueue failures.
5. Re-run upload/chat/worker-related regression tests and independently review lifecycle, error recovery and API compatibility.
6. Update database/queue and health-check code-specs with executable contracts.
7. Run focused tests, lint, typecheck, full Vitest, production build and diff checks.
8. Commit implementation, archive the task, record the journal, then continue to the next MAGI round.

## Risk And Rollback Points

- `src/lib/infra/queue.ts`: a rejected promise must be removed without deleting a newer retry promise; cleanup must compare promise identity.
- Dynamic pg-boss import must remain variable-based for Edge build compatibility.
- `src/app/healthz/ready/route.ts`: retain response field shapes and 2-second per-check timeouts; only the ready predicate changes.
- `src/app/api/upload/route.ts`: a null job id must reach the existing fallback via rejection.
- `src/app/api/chat/route.ts`: title/memory enqueue remains fire-and-forget and must not delay `[DONE]`.

## Validation Commands

- `pnpm exec vitest run src/lib/infra/queue.test.ts src/app/healthz/ready/route.test.ts src/app/api/upload/route.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## Completion Gate

- No `send()` can run before successful pg-boss start and target queue creation.
- Failed initialization does not poison future attempts.
- Readiness cannot return 200 when its queue check is false, errored or timed out.
- Independent review has no blocking finding and all automated gates pass.
