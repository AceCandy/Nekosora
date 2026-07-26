# Queue Reliability Research

## Repository Evidence

- `src/lib/infra/queue.ts:85-99`: `getQueue()` has no in-flight lock; `queueAvailable()` returns the adapter's constant `available` flag without starting or connecting.
- `src/lib/infra/queue.ts:57-73`: `send()` calls `boss.send()` directly, while only `work()` calls `createQueue()` first.
- `src/worker.ts:16-50`: worker order is start, then sequential `work()` registration for `file-process`, `memory-extract`, and `conversation-title`; Web processes do not share this process-local adapter.
- `src/instrumentation.ts:20,40-45`: startup explicitly leaves pg-boss initialization to the worker, so Web producers are not started there.
- `src/app/api/chat/route.ts:224-230,475-483`: title and memory jobs are fire-and-forget; title logs rejection, memory currently swallows it.
- `src/app/api/upload/route.ts:98-118`: file dispatch already falls back to local processing when queue acquisition or send throws, but a false success from an empty job id bypasses fallback.
- `src/app/healthz/ready/route.ts:30-84`: DB/storage/queue checks each have a two-second timeout, but HTTP readiness currently depends only on DB.

## pg-boss 11.1.2 Semantics

- The lockfile resolves pg-boss 11.1.2.
- `start()` installs or migrates the independent pg-boss schema, but does not create named queues.
- Concurrent/repeated `start()` calls made while startup is in progress return immediately rather than awaiting the first startup; an application-level promise is required.
- Sending to a missing queue rejects with `Queue <name> does not exist`.
- `createQueue()` is cross-process idempotent through `INSERT ... ON CONFLICT DO NOTHING`.
- `send()` can return `null`; treating it as an empty successful id loses the producer's fallback/error path.

## Scope Decision

This round guarantees queue backend initialization and dispatch prerequisites. It does not infer worker liveness from pg-boss startup, and it does not add outbox/exactly-once behavior.
