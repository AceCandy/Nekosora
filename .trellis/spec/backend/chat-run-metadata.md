# Chat Run Metadata

## 1. Scope / Trigger

Apply this contract when changing authenticated `/api/chat` generation, `runs`, assistant completion persistence, WebChat terminal SSE, Agent-loop usage, memory extraction intent production, or historical run metadata projection.

## 2. Signatures

- `startRunStrict(input): Promise<void>` confirms a `running` run before any model call.
- `executeChatCompletion(input): Promise<ChatCompletionOutcome>` owns streaming, first-terminal-cause, heartbeat, tool audit, completion commit, and the unique domain finish.
- `streamChatWithTools({ maxSteps = 5, ... })` permits at most `maxSteps` tool-execution rounds, followed by at most one forced summary request with `tools: undefined` when the last allowed round still produced tool calls.
- `persistChatCompletion(input): Promise<PersistChatCompletionResult>` commits assistant, conversation time, optional memory intent, and terminal run in one PostgreSQL transaction.
- Terminal run predicate: `run_id + conversation_id + user_id + status='running'`, with `RETURNING` exactly one row.
- Internal WebChat tail: success emits `finish(metadata) -> terminal(success) -> [DONE]`; failed/interrupted emit `terminal(status) -> [DONE]` after any existing error frame. `ChatTerminalStatus` is owned by `src/lib/chat/sse-contract.ts`.
- `memory_extraction_jobs`: one row per `run_id`, with run/conversation/user cascade FKs and a minimal JSONB message snapshot.

## 3. Contracts

- `runs` is the only run-metadata fact source. Do not copy model or usage onto messages and do not reconstruct Chat metadata from gateway execution facts.
- A run must be durably confirmed before model generation. A strict-start rejection or timeout does not call `streamChat` or `streamChatWithTools` and does not start heartbeat.
- The coordinator owns one first-terminal-cause latch: finish first is `success`; upstream error/throw first is `failed`; Abort first or natural EOF is `interrupted`. Later events cannot replace the first cause.
- Plain and Agent generation share one `runId`. Agent final finish usage is the sum of all step usage; its finish reason remains the final step reason.
- When the last allowed Agent round still returns `tool-calls`, execute those calls once, append their assistant/tool messages, and make exactly one summary request with the accumulated messages and no tools. That request cannot re-enter tool execution. `maxSteps=0` makes no model request.
- Only the forced summary's real `finish` may complete an exhausted Agent loop. Summary error is `failed`; Abort or natural EOF is `interrupted`; Abort wins over a late summary finish. All rounds share one telemetry session and one aggregate finalization.
- A post-tool model round that returns `finish` without any non-empty `text-delta` is not a successful final answer. Retry exactly once with `tools: undefined` and an explicit instruction to answer from the existing tool results; never execute the tool again. A second empty finish is an error, not a committed empty success.
- Stop heartbeat before the short completion transaction. Never keep a database transaction open across model generation.
- Lock order is conversation `FOR UPDATE`, active message/CAS validation, assistant write, conversation time, optional memory intent, then terminal run update.
- Continue updates require the original assistant content in the SQL predicate. Parent and source references are re-read inside the locked transaction.
- Compute `completedAt` and `durationMs` once before the completion call. The committed result, historical projection, and live finish metadata reuse those values.
- Only a committed `success` can emit domain finish. The route adapter maps the returned `ChatCompletionOutcomeKind` exhaustively to `terminal(success|failed|interrupted)`, then sends `[DONE]` as a transport-completion marker. Failed/interrupted outcomes never emit finish, but an open transport still receives terminal + DONE.
- The WebChat parser accepts success only when finish precedes terminal(success), and accepts any outcome only when terminal precedes DONE. DONE without terminal, success without finish, contradictory/duplicate terminal, or EOF before DONE is a protocol error.
- Abort during commit closes transport intent but does not cancel the database transaction or downgrade a finish already latched as success. The committed database outcome remains authoritative.
- `iterator.next()` races Abort. A provider that ignores its AbortSignal cannot indefinitely block coordinator convergence; iterator return is requested without awaiting an unresponsive provider.
- After consuming a provider `finish` or `error`, the coordinator advances the stream iterator once so the plain stream or Agent loop can run its own telemetry/finally cleanup before completion persistence. The Abort path keeps non-blocking iterator return semantics.
- A stream owns the nested gateway execution lifecycle: its `finally` requests nested engine closure on consumer `return()` without blocking the consumer, and runs any deferred final-usage callback from that same cleanup path. Final usage must not depend on code after the generator `finally` block.
- Memory intent creation is part of the completion transaction. Immediate queue dispatch and artifact persistence are post-commit optimizations and cannot change the core outcome.
- Public share DTOs never expose `MessageRunMetadata`. Historical loaders remain conversation-scoped and serialize dates as ISO strings.

## 4. Validation & Error Matrix

| Condition | Database result | SSE result |
| --- | --- | --- |
| Strict run start fails | No confirmed run; no model call | Generic error, terminal(failed), DONE if transport is open |
| Upstream finish then Abort | Commit success if repository succeeds | No later write when transport is cancelled |
| Abort then late finish | Commit interrupted partial assistant | Cancelled transport receives no later write |
| Upstream error then late finish | Commit failed partial assistant | One error, terminal(failed), DONE |
| Natural EOF | Commit interrupted partial assistant | Generic incomplete error, terminal(interrupted), DONE |
| Last tool round is exhausted, summary finishes | Commit one successful final answer with aggregate usage | One finish, terminal(success), DONE |
| Post-tool round finishes without text | Retry once without tools using existing results; commit only if text arrives | No repeated tool call; empty retry emits an error |
| Forced summary errors, ends without finish, or is aborted | Commit failed/interrupted partial assistant and retain tool output | No synthetic finish; terminal(failed/interrupted), DONE when open |
| Parent/source/continue CAS misses | Entire completion transaction rolls back | Persistence error, terminal(failed), DONE |
| Memory intent insert fails | Entire completion transaction rolls back | Persistence error, terminal(failed), DONE |
| Terminal run update returns zero rows | Entire completion transaction rolls back | Persistence error, terminal(failed), DONE |
| Completion commit succeeds | Assistant, conversation time, intent, and run are visible together | One finish, terminal(success), DONE |

## 5. Good / Base / Bad Cases

- Good: a successful assistant, run terminal metadata, conversation time, and memory intent become visible in the same commit.
- Good: two concurrent continues serialize on the conversation row; only one original-content CAS and run terminal update succeeds.
- Good: an Agent tool chain exposes one outer finish whose usage includes every model step.
- Good: the fifth tool round executes once, then one tool-disabled request summarizes all accumulated results.
- Good: an ordinary provider failure preserves its error frame, then sends terminal(failed) and DONE without emitting finish.
- Base: an interrupted generation stores partial assistant text with message status `interrupted` and run status `interrupted`.
- Bad: provider finish directly causes route `[DONE]` before the completion transaction commits.
- Bad: treating `[DONE]` or bare EOF as success without a validated terminal.
- Bad: assistant persistence and `finalizeRun` are separate success writes.
- Bad: raising the tool-round limit or letting the forced summary receive tools instead of guaranteeing convergence.
- Bad: queue acceptance is treated as memory business completion or deletes the durable intent.

## 6. Tests Required

- Run lifecycle tests: strict start waits for insert confirmation, rejects generically, and never exposes database details.
- Repository unit tests: insert/continue fields, reference validation, fixed write order, intent failure, run zero-row, and ownership fencing.
- Isolated PostgreSQL tests: concurrent continue has one winner; memory insert failure and terminal-run conflict roll back assistant, conversation time, intent, and run changes.
- Coordinator tests: finish-before-Abort, Abort-before-finish, error-before-late-finish, natural EOF, duplicate terminal events, commit failure, an Abort-ignoring iterator, and one-step iterator settlement after finish/error.
- Agent-loop tests: one outer finish, one shared run ID, aggregate usage, one aggregate telemetry finalization, exhausted-round summary with `tools: undefined`, post-tool empty-finish retry, no repeated tool execution, `maxSteps=0`, summary error/EOF, and Abort beating a late finish.
- Stream telemetry tests: natural final-usage callback and consumer Abort/`return()` finalization of the nested execution.
- Route tests: identity/context wire fields, delta/reasoning/tool/error mapping, all six outcome-to-terminal mappings, finish-before-terminal-before-DONE, no finish on failure, and reader-cancel signal propagation.
- Client parser/store tests: strict terminal/DONE gate, contradictory/duplicate terminal, chunked final frame, EOF rejection, four generation actions mapping only terminal success to message success, and one visible error append.
- Schema/migration tests: memory intent primary key, unique run, three cascade FKs, dispatch index, SQL, journal, and snapshot continuity.
- Existing history, version switching, client SSE parser, store, and public-share tests must remain green.

## 7. Wrong vs Correct

```typescript
// Wrong: independent writes allow a visible assistant without matching run/intention facts.
await persistAssistant();
await finalizeRun({ runId, status: "success" });
queue.send("memory-extract", fullPayload);
enqueue(doneFrame);

// Correct: coordinator finish comes only from committed success;
// the route serializes the returned outcome as the separate wire terminal.
const outcome = await executeChatCompletion(input);
safeEnqueue(terminalFrame(TERMINAL_STATUS_BY_OUTCOME[outcome.kind]));
safeEnqueue(doneFrame);
```

```typescript
// Wrong: Abort can overwrite a finish that was already observed.
const status = signal.aborted ? "interrupted" : finished ? "success" : "failed";

// Correct: latch the first terminal cause and never recompute it from mutable booleans.
latch(event.type === "finish" ? "success" : "failed");
```

```typescript
// Wrong: another tool-enabled round can repeat forever or end without a domain finish.
await streamChat({ request: { ...request, messages, tools } });

// Correct: after the last allowed tool execution, permit one converging summary only.
await streamChat({ request: { ...request, messages, tools: undefined } });
```
