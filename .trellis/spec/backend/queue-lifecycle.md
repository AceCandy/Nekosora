# Queue And Worker Lifecycle

> Typed pg-boss catalog, replaceable generation, worker recovery, and drain contracts for Nekusora.

## Scenario: pg-boss Producer Lifecycle And Readiness

### 1. Scope / Trigger

Apply this contract when changing `packages/queue`, Gateway/Web producers, queue workers, or process readiness. Every process has its own in-memory adapter, so no producer may rely on another process having started pg-boss or created a named queue.

### 2. Signatures

- `getQueue(): Promise<QueueAdapter>`
- `configureQueueProvider(provider: () => Promise<QueueAdapter>): void`
- `QueueDefinition<TPayload> = { name, policy, retryMessage }`
- `JobOutcome = "completed" | "noop"`
- `QueueAdapter.start(): Promise<void>` / `stop(): Promise<void>`
- `QueueAdapter.send(definition, payload, opts?): Promise<string>`
- `QueueAdapter.work(definition, handler): Promise<void>`
- `JobHandler<T> = (data: T) => Promise<JobOutcome>`
- `createWorkerRuntime({ queue, definitions, process }): WorkerRuntimeController`
- `queueAvailable(): Promise<boolean>`
- `GET /healthz/ready -> { status, checks, ts }`
- Worker `GET /healthz -> 200` and `GET /healthz/ready -> 200|503`

### 3. Contracts

- `packages/queue/src/index.ts` loads `pg-boss` with the literal dynamic import `import("pg-boss")`. Variable-path imports are forbidden. Only Gateway and Worker depend on this adapter package; Web and Core dependency graphs must not contain it.
- `@nekusora/contracts/queue` is the only queue-name, payload, retry-message, policy, and driver-neutral adapter type source. The three current definitions use `retryLimit=2`, `retryDelay=0`, `retryBackoff=false`, and `expireInSeconds=900`; `createQueue` and `send` receive mutable copies because pg-boss mutates option objects.
- Core exposes a process-local Queue provider. Gateway and Worker call `configureQueueProvider(getQueue)` during startup; Web never configures the provider. Upload preserves its synchronous fallback when acquisition fails. Title/memory dispatch must acquire the provider before claiming a due durable row so an absent Web provider cannot postpone Worker recovery by 15 minutes.
- The adapter is process-local singleton API, but each pg-boss instance is a replaceable generation. Constructor/start/stop failure and normal stop poison and discard that generation; a later call constructs a new instance.
- Start, stop, and same-name queue creation are single-flight within one generation. A start/send/work arriving during stop waits for the old generation to close, starts a new generation, and never registers work against the old identity.
- Admission is synchronous after startup: verify current generation identity/state, then add the operation promise to that generation. Stop first changes state to `stopping`, rejects old-generation admission, waits accepted operations, then calls `boss.stop({ close: true, graceful: true, wait: true, timeout: 30000 })`.
- `send()` and `work()` always await generation start and idempotent `createQueue(definition.name, policy)`. Queue creation is lazy per definition name and scoped to the generation.
- `send()` succeeds only with a non-empty job id. A `null`/empty id rejects so producer fallback or logging runs.
- The adapter tracks the real business-handler Promise. A clean stop requires pg-boss stop to resolve before the monotonic 30-second deadline and the generation handler set to be empty; timeout/late completion rejects with `QUEUE_DRAIN_TIMEOUT_MESSAGE` even if pg-boss itself resolved after `failWip()`.
- A worker handler resolves only with `completed` or `noop`. Invalid outcomes and recoverable service/provider/persistence failures reject the pg-boss callback with a new `Error(definition.retryMessage)` without raw `cause` or stack.
- Retried handlers must be idempotent or use conditional writes. `conversation-title` re-reads the current title and only updates `新会话` or the job's fallback, so a retry cannot overwrite a manual title.
- pg-boss `error` events log only `[queue] pg-boss error`. Worker/recovery lifecycle logs contain only stable stage, definition name, and `JobOutcome`; never log payload, entity id, raw error, URL, header, credential, cause, or stack.
- The generic worker runtime owns registration order, immediate/60-second/unref/single-flight recovery scheduling, reverse rollback, and SIGINT/SIGTERM shutdown. Shutdown during startup waits for startup to converge before cleanup; repeated signals reuse one Promise and call `exit` once.
- `queueAvailable()` awaits real pg-boss startup. Gateway readiness requires both DB and queue checks. Web readiness checks only Web-owned dependencies and does not initialize Queue. Worker readiness is 503 during startup and shutdown, and 200 only after queue registration/recovery startup completes; liveness remains 200 during drain.
- Queue readiness means that this process can initialize the queue backend. It does not prove that the independent worker is alive or consuming jobs.
- Worker shutdown marks unready, stops recovery in reverse order, drains Queue, closes DB and the health listener, then exits once. In its container, `LOCAL_STORAGE_DIR=/app/uploads` must match the declared shared volume; relative defaults from another process working directory are forbidden.

### 4. Validation & Error Matrix

| Condition | Adapter result | Readiness / producer result |
| --- | --- | --- |
| Concurrent cold calls | One adapter/generation/start/create per name | All callers await the same result |
| Constructor/start rejects | Best-effort close and discard generation | Later call constructs a new pg-boss instance |
| Stop resolves or rejects | Discard generation | Later call constructs and starts a new instance |
| Operation admitted before stop | Track in generation operation set | Stop waits before calling pg-boss stop |
| Send/work arrives after stop admission closes | Do not use old generation | Wait close, then operate on a new generation |
| `send()` returns a non-empty id | Resolve id | Producer treats dispatch as successful |
| `send()` returns `null` or empty string | Reject | Upload fallback or chat async error path |
| Worker handler returns `completed` or `noop` | Resolve callback | pg-boss completes the job |
| Worker handler throws or returns another value | Reject callback with catalog retry message | pg-boss applies finite retry/failure policy |
| pg-boss stop returns before 30 seconds and no handler remains | Resolve stop | Clean worker exit |
| Deadline reached or a real handler remains | Reject stable drain error; discard generation | Worker continues cleanup and exits non-zero |
| Worker service catches a recoverable failure and returns | False success | Job is permanently acknowledged; forbidden |
| Gateway DB and queue startup succeed | Queue `{ available: true }` | Gateway HTTP 200 `ready` |
| Gateway queue false/error/timeout | Preserve queue diagnostic | Gateway HTTP 503 `unready` |
| Web has no Queue provider | Do not claim title/memory durable rows; upload uses existing fallback | Web readiness remains based on Web-owned DB |
| Worker startup / running / shutdown | Health state `starting / ready / stopping` | Readiness `503 / 200 / 503`; liveness stays 200 until listener close |
| Worker local storage path differs from mounted volume | Invalid deployment | Refuse the mismatch in review; set `/app/uploads` explicitly |
| Worker is offline but queue backend is writable | Jobs remain durable in pg-boss | Readiness does not infer worker liveness |

### 5. Good / Base / Bad Cases

- Good: Gateway can cold-start a generation, create `memory-extract` from the shared contract definition, and send before Worker has registered `work()`.
- Good: Web title/memory dispatch fails before DB claim, leaving the durable row due for Worker's immediate scan.
- Good: stop times out after pg-boss moves WIP to retry/failed; the adapter still rejects and worker exits non-zero instead of reporting a clean drain.
- Good: title generation throws internally; the callback exposes only `CONVERSATION_TITLE_QUEUE.retryMessage`, while a missing/stale/manual-renamed job returns `noop`.
- Base: a started worker registers all catalog definitions, then starts all generic recovery schedulers.
- Base: a batch callback awaits jobs in order; the first rejection aborts that callback instead of continuing and acknowledging later work.
- Bad: reuse a pg-boss object after `start()` rejected; pg-boss 11.1.2 can retain an internal `#starting` promise and cannot be reliably restarted.
- Bad: pass the frozen catalog policy object directly to `createQueue`; pg-boss mutates its options.
- Bad: a service catches a model or database failure and returns `null` when `null` also means a valid no-op; the worker cannot distinguish failure and pg-boss records success.
- Bad: Gateway readiness returns 200 based only on DB while queue startup errored or timed out.
- Bad: importing `@nekusora/queue/types` from Core appears type-only in code but still pulls the adapter package and `pg-boss` into Web's package dependency graph.
- Bad: mounting `/app/uploads` while a Worker relative default resolves to `/uploads` splits producer and consumer storage ownership.

### 6. Tests Required

- Contract/catalog tests assert all names, minimal payload types, finite policy, and stable retry messages.
- Queue unit tests cover constructor/start/create failure replacement, normal/failed stop replacement, same/different-name create, overlapping start/stop, double stop, stop-time send/work, accepted-operation drain, active-handler drain, deadline crossing, and mutable policy copies.
- Execute the callback passed to pg-boss. `completed/noop` resolve; any other result or throw becomes a new catalog-safe error, stops the current batch, and contains no raw payload, URL, header, credential, cause, or stack.
- Runtime tests cover registration-before-recovery, immediate/60-second/unref/single-flight scheduler behavior, stop waiting for active scans, every startup rollback point, cleanup-failure isolation, shutdown during startup, and repeated cross-signal shutdown with exactly one exit.
- Run the isolated real PostgreSQL harness to prove clean drain completes the job and 30-second timeout leaves the job `retry`/`failed`, then force-drop the random temporary database in `finally`.
- Gateway readiness route tests cover healthy DB+queue, queue false, reject, timeout, and DB failure; assert HTTP status and `checks.queue` shape. Web readiness tests assert Queue is absent from checks. Worker health tests assert `503 -> 200 -> 503` readiness and drain-time liveness.
- Upload regression proves acquisition/send failures still call `processFile` fallback exactly once and return the existing success response.
- Provider regressions prove missing provider rejection occurs before title/memory DB claim. Runtime tests assert resource close follows Queue drain and repeated signals still exit once.
- Run `pnpm build`, `pnpm build:gateway`, `pnpm build:worker`, and inspect `pnpm --filter @nekusora/web list --depth Infinity`; Web output/graph must omit the Queue adapter and `pg-boss`.

### 7. Wrong vs Correct

```typescript
// Wrong: string names duplicate the catalog and bypass typed payload/policy.
const queue = await getQueue();
await queue.send("file-process", { fileId, storagePath, mime });

// Correct: the definition owns name, payload type, policy, and safe retry message.
const queue = await getQueue();
const jobId = await queue.send(FILE_PROCESS_QUEUE, { fileId });

// Wrong: Core package metadata still pulls the driver into Web.
import type { QueueAdapter } from "@nekusora/queue/types";

// Correct: contracts are independent of the pg-boss adapter package.
import type { QueueAdapter } from "@nekusora/contracts/queue";

// Wrong: retryable failure is converted into a successful callback.
try {
  await generateConversationTitle(data);
} catch {
  return;
}

// Correct: only explicit no-op resolves; generation failure rejects generically.
return processConversationTitleJob(data.id);
```
