# Technical Design

## Boundary

将启动、建队列和投递前置条件全部收口到 `src/lib/infra/queue.ts` 的 QueueAdapter。生产者不各自判断 pg-boss 生命周期；readiness 通过同一 adapter 的真实 `start()` 验证队列后端。API payload、job name、worker handler 和数据库结构不变。

## State Model

- 模块级 `adapterPromise`：合并并发 `buildAdapter()`；失败时清空。
- adapter 级 `startPromise`：合并并发 `boss.start()`；失败或 stop 后清空。
- adapter 级 `stopPromise`：合并并发停止，并让 stop 期间的新 start/send 等待停止完成后重新启动。
- adapter 级 `queuePromises: Map<string, Promise<void>>`：每个 job name 合并 `createQueue()`；失败时删除对应 entry。
- adapter 级 `activeOperations`：只跟踪正在执行的 send/work，允许它们并发，但 stop 必须等待已登记操作完成。

不额外维护容易漂移的 boolean。resolved promise 本身表示成功状态，rejected promise 在 catch 中被移除。

## Data Flow

```text
Web producer / worker / readiness
  -> getQueue() single-flight adapter
  -> start() single-flight pg-boss initialization
  -> send/work: ensureQueue(name) single-flight createQueue
  -> boss.send / boss.work

/healthz/ready
  -> DB select 1
  -> queueAvailable -> adapter.start
  -> DB ok && queue available -> 200
  -> either required check false/error/timeout -> 503
```

## Contracts

- `send()` resolves only with a non-empty pg-boss job id; `null` is a dispatch failure.
- `send()` and `work()` always await start and queue creation in that order.
- `createQueue()` is safe to repeat across processes because pg-boss 11.1.2 uses `ON CONFLICT DO NOTHING`; the local map only removes redundant same-process calls.
- `stop()` waits for pg-boss and clears only process-local startup state so a later start can run again; queues persist in PostgreSQL.
- A start/send/work that arrives while stop is in progress waits for stop and performs a fresh pg-boss start before continuing.
- `queueAvailable()` starts the adapter and returns true only after initialization succeeds. It does not inspect worker liveness.
- Queue failures continue propagating to existing producer catches. No producer awaits title/memory work completion.

## Validation Matrix

| Condition | Queue behavior | Readiness / caller behavior |
| --- | --- | --- |
| Concurrent cold calls | One adapter/start/create per name | All await same result |
| Adapter/start/create fails | Reject and clear failed promise | Later call can retry |
| `boss.send()` returns null | Reject explicit dispatch error | Upload fallback or chat async catch |
| DB ok, queue start ok | Available true | 200 ready |
| DB ok, queue false/error/timeout | Not available | 503 with queue diagnostic |
| Queue ok, DB error/timeout | Queue diagnostic retained | 503 |

## Compatibility And Trade-Offs

- Starting pg-boss lazily in Web processes creates its normal timers/connections, but Web producers already depend on pg-boss for durable dispatch; pretending the adapter is available without starting it is invalid.
- Queue creation remains lazy per job name instead of maintaining a second central registry, so new producers automatically get the invariant without updating a list.
- Worker heartbeat and outbox would provide stronger guarantees but require new persistent state and operational policy; they are intentionally deferred.

## Rollback

All changes are code-only. Reverting the adapter lifecycle and readiness predicate restores prior behavior; no schema or data rollback is required.
