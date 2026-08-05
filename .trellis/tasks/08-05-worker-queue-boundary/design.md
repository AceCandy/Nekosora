# Design

- `apps/worker` remains a thin Node process around the existing generic worker runtime and definition table.
- `packages/queue` owns catalog and pg-boss adapter; domain handlers live in the shared server domain package used by Gateway and Worker.
- Replace variable import paths with literal imports. This is safe because Worker/Gateway are compiled as Node applications and the package is absent from Web imports.
- Add a small native Node HTTP health listener bound to an internal port. It reports liveness and runtime readiness only; it does not expose payload/job details.
- Shutdown first marks unready, stops health acceptance, drains recovery/handlers/queue, closes process-local DB/storage, then exits once.
- Mount the same upload volume into Gateway and Worker for local storage mode.

Rollback: run the previous Worker entry against the same pg-boss schema/catalog; no queue or DB migration is introduced.
