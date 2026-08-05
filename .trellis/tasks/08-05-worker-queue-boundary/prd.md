# Worker 与队列运行时隔离

## Goal

Move the pg-boss consumer into `apps/worker`, preserve all queue lifecycle guarantees, and make queue/storage ownership independent from the Next Web process.

## Requirements

- Worker uses shared typed queue definitions and static/literal Node imports.
- Preserve registration order, recovery cadence, idempotency, retries, drain deadline, safe logs and signal behavior.
- Provide process-local health state and an independent deployment entry.
- Allocate an explicit Worker DB pool budget and shared local-storage volume.

## Acceptance Criteria

- [ ] Existing queue adapter/runtime/definition tests pass from the Worker/shared packages.
- [ ] Real PostgreSQL lifecycle tests prove completion, retry and drain timeout behavior.
- [ ] Worker readiness changes correctly across startup, running and shutdown.
- [ ] Web build and dependency graph contain no pg-boss adapter.
- [ ] Repeated SIGINT/SIGTERM performs one cleanup and one exit.

## Out of Scope

- Changing queue technology or job policy.
- Adding per-domain worker services.
