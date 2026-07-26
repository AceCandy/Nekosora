# Pending File Recovery Research

## Confirmed Failure Chain

1. Upload writes storage, then inserts `file_objects` with `processing_status='pending'` (`src/app/api/upload/route.ts:89-109`).
2. Only after that commit does it call `getQueue().send('file-process', ...)` (`src/app/api/upload/route.ts:119-131`).
3. Queue acquisition/send failure starts non-awaited `processFile(...).catch(...)` and returns HTTP 200 (`src/app/api/upload/route.ts:132-139`).
4. `processFile` does not claim until after its asynchronous `getDb()` and conditional UPDATE (`src/lib/rag/process.ts:27-57`). The Web process can exit before that UPDATE, leaving the row pending.
5. Worker recovery only queries stale `extracting/embedding`; pending cannot be selected (`src/lib/rag/recovery.ts:11-35`). No later durable trigger remains.

## Existing Idempotency Primitive

`processFile` already claims with one conditional UPDATE. It accepts `pending/error`, or active rows with NULL/expired database-time leases, sets a new random token and fresh lease, and returns before extraction when no row is returned. Therefore queue handler, Web fallback and scanner can safely race without a new lock protocol.

All post-claim writes match file id, token, active state and unexpired lease. Chunk replacement and final state are one transaction. The selected fix can reuse these guarantees and should not duplicate them in the recovery layer.

## Existing Recovery Contract Drift

Round 20's design states that Web fallback process exit is recovered by the same scanner (`archive/...round-20/design.md:113`), but its implemented predicate and current `file-storage.md:457` only cover stale active rows. This is implementation/spec drift, not a new product decision.

## Selected Boundary

- Include pending in the worker scanner.
- Exclude error and terminal rows.
- Keep immediate queue and Web fallback paths for latency.
- Add a pending partial index because the scanner runs every minute and the existing active partial index cannot serve pending rows.
- Do not introduce a generic outbox: file_objects already contains the durable payload (`id`, `storage_path`, `mime`) and atomic state machine.

## Verification Boundary

The existing PostgreSQL harness already exercises real migrations, concurrent claims, fencing, row locks, rollback, stale scanning and cleanup. Extend it with pending recovery and mixed candidates rather than relying only on a Drizzle mock.
