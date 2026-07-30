# Chat Run Metadata

## 1. Scope / Trigger

Apply this contract when changing authenticated `/api/chat` generation, `runs`, assistant completion persistence, WebChat terminal SSE, Agent-loop usage, memory extraction intent production, or historical run metadata projection.

## 2. Signatures

- `startRunStrict(input): Promise<void>` confirms a `running` run before any model call.
- `executeChatCompletion(input): Promise<ChatCompletionOutcome>` owns streaming, first-terminal-cause, heartbeat, tool audit, completion commit, and the unique domain finish.
- `persistChatCompletion(input): Promise<PersistChatCompletionResult>` commits assistant, conversation time, optional memory intent, and terminal run in one PostgreSQL transaction.
- Terminal run predicate: `run_id + conversation_id + user_id + status='running'`, with `RETURNING` exactly one row.
- SSE success tail: `data: {"type":"finish","metadata":MessageRunMetadata}` followed immediately by `data: [DONE]`.
- `memory_extraction_jobs`: one row per `run_id`, with run/conversation/user cascade FKs and a minimal JSONB message snapshot.

## 3. Contracts

- `runs` is the only run-metadata fact source. Do not copy model or usage onto messages and do not reconstruct Chat metadata from gateway execution facts.
- A run must be durably confirmed before model generation. A strict-start rejection or timeout does not call `streamChat` or `streamChatWithTools` and does not start heartbeat.
- The coordinator owns one first-terminal-cause latch: finish first is `success`; upstream error/throw first is `failed`; Abort first or natural EOF is `interrupted`. Later events cannot replace the first cause.
- Plain and Agent generation share one `runId`. Agent final finish usage is the sum of all step usage; its finish reason remains the final step reason.
- Stop heartbeat before the short completion transaction. Never keep a database transaction open across model generation.
- Lock order is conversation `FOR UPDATE`, active message/CAS validation, assistant write, conversation time, optional memory intent, then terminal run update.
- Continue updates require the original assistant content in the SQL predicate. Parent and source references are re-read inside the locked transaction.
- Compute `completedAt` and `durationMs` once before the completion call. The committed result, historical projection, and live finish metadata reuse those values.
- Only a committed `success` can emit domain finish. The route adapter serializes that one finish and `[DONE]`; failed, interrupted, start-failed, and persistence-failed outcomes never emit success signals.
- Abort during commit closes transport intent but does not cancel the database transaction or downgrade a finish already latched as success. The committed database outcome remains authoritative.
- `iterator.next()` races Abort. A provider that ignores its AbortSignal cannot indefinitely block coordinator convergence; iterator return is requested without awaiting an unresponsive provider.
- Memory intent creation is part of the completion transaction. Immediate queue dispatch and artifact persistence are post-commit optimizations and cannot change the core outcome.
- Public share DTOs never expose `MessageRunMetadata`. Historical loaders remain conversation-scoped and serialize dates as ISO strings.

## 4. Validation & Error Matrix

| Condition | Database result | SSE result |
| --- | --- | --- |
| Strict run start fails | No confirmed run; no model call | One generic error if transport is open; no finish/DONE |
| Upstream finish then Abort | Commit success if repository succeeds | No later write when transport is cancelled |
| Abort then late finish | Commit interrupted partial assistant | No finish/DONE |
| Upstream error then late finish | Commit failed partial assistant | One error; no finish/DONE |
| Natural EOF | Commit interrupted partial assistant | Generic incomplete error; no finish/DONE |
| Parent/source/continue CAS misses | Entire completion transaction rolls back | Persistence error; no finish/DONE |
| Memory intent insert fails | Entire completion transaction rolls back | Persistence error; no finish/DONE |
| Terminal run update returns zero rows | Entire completion transaction rolls back | Persistence error; no finish/DONE |
| Completion commit succeeds | Assistant, conversation time, intent, and run are visible together | One finish, then DONE |

## 5. Good / Base / Bad Cases

- Good: a successful assistant, run terminal metadata, conversation time, and memory intent become visible in the same commit.
- Good: two concurrent continues serialize on the conversation row; only one original-content CAS and run terminal update succeeds.
- Good: an Agent tool chain exposes one outer finish whose usage includes every model step.
- Base: an interrupted generation stores partial assistant text with message status `interrupted` and run status `interrupted`.
- Bad: provider finish directly causes route `[DONE]` before the completion transaction commits.
- Bad: assistant persistence and `finalizeRun` are separate success writes.
- Bad: queue acceptance is treated as memory business completion or deletes the durable intent.

## 6. Tests Required

- Run lifecycle tests: strict start waits for insert confirmation, rejects generically, and never exposes database details.
- Repository unit tests: insert/continue fields, reference validation, fixed write order, intent failure, run zero-row, and ownership fencing.
- Isolated PostgreSQL tests: concurrent continue has one winner; memory insert failure and terminal-run conflict roll back assistant, conversation time, intent, and run changes.
- Coordinator tests: finish-before-Abort, Abort-before-finish, error-before-late-finish, natural EOF, duplicate terminal events, commit failure, and an Abort-ignoring iterator.
- Agent-loop tests: one outer finish, one shared run ID, aggregate usage, and one aggregate telemetry finalization.
- Route tests: identity/context wire fields, delta/reasoning/tool/error mapping, finish-before-DONE, no success signals on failure, and reader-cancel signal propagation.
- Schema/migration tests: memory intent primary key, unique run, three cascade FKs, dispatch index, SQL, journal, and snapshot continuity.
- Existing history, version switching, client SSE parser, store, and public-share tests must remain green.

## 7. Wrong vs Correct

```typescript
// Wrong: independent writes allow a visible assistant without matching run/intention facts.
await persistAssistant();
await finalizeRun({ runId, status: "success" });
queue.send("memory-extract", fullPayload);
enqueue(doneFrame);

// Correct: the coordinator emits success only from the committed repository result.
await startRunStrict(start);
const committed = await persistChatCompletion(completion);
emit({ type: "finish", metadata: toMetadata(committed) });
emitDone();
```

```typescript
// Wrong: Abort can overwrite a finish that was already observed.
const status = signal.aborted ? "interrupted" : finished ? "success" : "failed";

// Correct: latch the first terminal cause and never recompute it from mutable booleans.
latch(event.type === "finish" ? "success" : "failed");
```
