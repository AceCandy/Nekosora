# Design

- `apps/worker` remains a thin Node process around the existing generic worker runtime and definition table in Core.
- `@nekusora/contracts/queue` owns the catalog and driver-neutral types; `packages/queue` owns only the pg-boss adapter and compatibility re-exports. Core depends on contracts and exposes a process-local Queue provider; Gateway and Worker inject the pg-boss adapter during startup.
- Web does not configure a Queue provider. Upload keeps its existing synchronous fallback, while title/memory durable outbox rows remain due for the Worker's immediate recovery scan. Dispatch obtains the provider before claiming a row so an unavailable provider cannot postpone recovery.
- Web readiness checks only Web-owned critical dependencies. Queue readiness belongs to the independent Worker probe.
- Replace variable import paths with literal imports. This is safe because Worker/Gateway are compiled as Node applications and the package is absent from Web imports.
- Add a small native Node HTTP health listener bound to an internal port. It reports liveness and runtime readiness only; it does not expose payload/job details.
- Shutdown first marks unready, keeps liveness during drain, stops recovery/handlers/queue, closes the process-local DB and health listener, then exits once. Storage currently owns no persistent closeable resource.
- Mount the same upload volume into Gateway and Worker for local storage mode.

Rollback: run the previous Worker entry against the same pg-boss schema/catalog; no queue or DB migration is introduced.
