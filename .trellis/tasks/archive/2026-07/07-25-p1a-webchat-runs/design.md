# Design: P1-A WebChat run lifecycle

## Boundary

- New module: `src/lib/chat/run-lifecycle.ts`（+ test）
- Wire-in: `src/app/api/chat/route.ts`
- Touch only as needed: pass `runId` into `streamChat` / `streamChatWithTools`
- Out of scope: frontend, schema/migration, usage_logs redesign, firstTokenLatency backfill

## Data flow

```
POST /api/chat
  → createRunId()
  → insert user (send only, with runId)
  → startRun(status=running) before stream
  → streamChat{WithTools}({ runId })
      tool-call  → recordToolCallStart (best-effort)
      tool-result→ recordToolCallResult (best-effort)
      finish     → capture usage, mark finished
      error/abort→ mark failed/interrupted
  → persist assistant with runId
  → finalizeRun(status, tokenUsage) in finally
```

## Status mapping

| Outcome | run.status |
|---|---|
| received finish | success |
| abortSignal aborted | interrupted |
| stream error / thrown exception | failed |
| no finish (e.g. maxSteps) | interrupted |

## Message runId rules

| Scenario | user message | assistant message |
|---|---|---|
| send (new user) | insert with runId | insert with runId |
| retry/edit (reuse user) | leave as-is | insert with runId |
| continue | leave as-is | update same row with runId |

## Safe jsonb

`toSafeJsonb(value)`:

- Drop/redact sensitive keys (`authorization`, `apiKey`, `api_key`, `password`, `secret`, `token`, `cookie`, …)
- Handle circular refs, BigInt, non-JSON types
- Bound depth/size; never throw

## Failure isolation

All run/tool persistence wraps try/catch → `console.error` with short code, no args/results/secrets. Stream continues.

## Compatibility

- SSE payload unchanged
- streamChat logUsage still per-step; shared runId only links ops/usage requestId when route passes it
