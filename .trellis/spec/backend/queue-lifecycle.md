# Queue And Worker Lifecycle

> Typed pg-boss catalog, replaceable generation, worker recovery, and drain contracts for Nekusora.

## Scenario: pg-boss Producer Lifecycle And Readiness

### 1. Scope / Trigger

Apply this contract when changing `src/lib/infra/queue.ts`, Web/worker queue producers, queue workers, or `/healthz/ready`. Web and worker processes have separate in-memory adapters, so no producer may rely on another process having started pg-boss or created a named queue.

### 2. Signatures

- `getQueue(): Promise<QueueAdapter>`
- `QueueDefinition<TPayload> = { name, policy, retryMessage }`
- `JobOutcome = "completed" | "noop"`
- `QueueAdapter.start(): Promise<void>` / `stop(): Promise<void>`
- `QueueAdapter.send(definition, payload, opts?): Promise<string>`
- `QueueAdapter.work(definition, handler): Promise<void>`
- `JobHandler<T> = (data: T) => Promise<JobOutcome>`
- `createWorkerRuntime({ queue, definitions, process }): WorkerRuntimeController`
- `queueAvailable(): Promise<boolean>`
- `GET /healthz/ready -> { status, checks, ts }`

### 3. Contracts

- Load `pg-boss` with the literal dynamic import `import("pg-boss")` and keep it in Next `serverExternalPackages`; variable-path imports are not statically analyzable, while a top-level static import reaches Edge instrumentation.
- `src/lib/jobs/catalog.ts` is the only queue-name, payload, retry-message, and policy source. The three current definitions use `retryLimit=2`, `retryDelay=0`, `retryBackoff=false`, and `expireInSeconds=900`; `createQueue` and `send` receive mutable copies because pg-boss mutates option objects.
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
- `queueAvailable()` awaits real pg-boss startup. Readiness requires both DB and queue checks; storage and Redis remain informational/degradable.
- Queue readiness means that this process can initialize the queue backend. It does not prove that the independent worker is alive or consuming jobs.

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
| DB and queue startup succeed | Queue `{ available: true }` | HTTP 200 `ready` |
| Queue false/error/timeout | Preserve queue diagnostic | HTTP 503 `unready` |
| Worker is offline but queue backend is writable | Jobs remain durable in pg-boss | Readiness does not infer worker liveness |

### 5. Good / Base / Bad Cases

- Good: a Web producer can cold-start a generation, create `memory-extract` from its catalog definition, and send before any worker process has registered `work()`.
- Good: stop times out after pg-boss moves WIP to retry/failed; the adapter still rejects and worker exits non-zero instead of reporting a clean drain.
- Good: title generation throws internally; the callback exposes only `CONVERSATION_TITLE_QUEUE.retryMessage`, while a missing/stale/manual-renamed job returns `noop`.
- Base: a started worker registers all catalog definitions, then starts all generic recovery schedulers.
- Base: a batch callback awaits jobs in order; the first rejection aborts that callback instead of continuing and acknowledging later work.
- Bad: reuse a pg-boss object after `start()` rejected; pg-boss 11.1.2 can retain an internal `#starting` promise and cannot be reliably restarted.
- Bad: pass the frozen catalog policy object directly to `createQueue`; pg-boss mutates its options.
- Bad: a service catches a model or database failure and returns `null` when `null` also means a valid no-op; the worker cannot distinguish failure and pg-boss records success.
- Bad: readiness returns 200 based only on DB while queue startup errored or timed out.

### 6. Tests Required

- Catalog tests assert all names, minimal payload types, finite policy, and stable retry messages.
- Queue unit tests cover constructor/start/create failure replacement, normal/failed stop replacement, same/different-name create, overlapping start/stop, double stop, stop-time send/work, accepted-operation drain, active-handler drain, deadline crossing, and mutable policy copies.
- Execute the callback passed to pg-boss. `completed/noop` resolve; any other result or throw becomes a new catalog-safe error, stops the current batch, and contains no raw payload, URL, header, credential, cause, or stack.
- Runtime tests cover registration-before-recovery, immediate/60-second/unref/single-flight scheduler behavior, stop waiting for active scans, every startup rollback point, cleanup-failure isolation, shutdown during startup, and repeated cross-signal shutdown with exactly one exit.
- Run the isolated real PostgreSQL harness to prove clean drain completes the job and 30-second timeout leaves the job `retry`/`failed`, then force-drop the random temporary database in `finally`.
- Readiness route tests cover healthy DB+queue, queue false, reject, timeout, and DB failure; assert HTTP status and `checks.queue` shape.
- Upload regression proves acquisition/send failures still call `processFile` fallback exactly once and return the existing success response.
- Run `pnpm build` to protect the variable dynamic-import boundary.

### 7. Wrong vs Correct

```typescript
// Wrong: string names duplicate the catalog and bypass typed payload/policy.
const queue = await getQueue();
await queue.send("file-process", { fileId, storagePath, mime });

// Correct: the definition owns name, payload type, policy, and safe retry message.
const queue = await getQueue();
const jobId = await queue.send(FILE_PROCESS_QUEUE, { fileId });

// Wrong: retryable failure is converted into a successful callback.
try {
  await generateConversationTitle(data);
} catch {
  return;
}

// Correct: only explicit no-op resolves; generation failure rejects generically.
return processConversationTitleJob(data.id);
```
