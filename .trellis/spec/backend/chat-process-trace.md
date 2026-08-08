# Chat Process Trace

## 1. Scope / Trigger

Apply this contract when changing Chat context preparation, reasoning/tool/search lifecycle events, `/api/chat` SSE, assistant `processTrace` persistence, history/version projection, or the unified pre-answer process UI.

## 2. Signatures

- Shared contract owner: `@nekusora/contracts/chat` exports `ChatProcessEvent`, `ChatProcessSnapshot`, and their runtime guards.
- `ChatProcessRecorder` owns run-local monotonic `seq`, phase progression, step upsert, terminal projection, and best-effort event emission.
- SSE process frame: `ChatProcessEvent` with `type="trace"`, `version=1`, `runId`, `seq`, `at`, `phase`, and either `action="phase"` or `action="step"`.
- Persistent message field: `ProcessTrace.process?: { version: 1; runs: ChatProcessRunSnapshot[] }`.
- Client projection: `reduceChatProcessEvent(previous, event)` and `snapshotFromProcessRuntime(runtime, existing)`.

## 3. Contracts

- A recorder starts only after `startRunStrict` succeeds. Start rejection produces no process events or fake persisted run.
- Phases only advance: `preparing -> processing -> answering -> completed|failed|interrupted`. The first non-empty text delta must be preceded by `answering`.
- Steps use stable IDs. Tool and Web Search steps include `toolCallId`; consumers never join by tool name or array position.
- Trace payloads are allowlisted metadata only. Do not include prompt text, memory text, hidden reasoning, tool arguments/results, search query/snippets, secrets, or raw provider errors.
- The completion transaction stores a projected terminal snapshot. The terminal trace event is emitted only after persistence succeeds; persistence failure emits `failed`.
- Continue appends a run snapshot and preserves older runs and Web Search calls. Regenerate/version switch uses the selected assistant's own snapshot.
- The SSE parser validates trace frames once with the shared guard and preserves the existing `finish -> terminal(success) -> [DONE]` contract.
- If a best-effort terminal trace is lost, the validated SSE terminal locally converges the client runtime to the same terminal phase.
- UI projects raw steps into user-facing research stages (`understand/context/reasoning/search/read/answer`). It never renders prompt construction, hidden reasoning, raw tool names/arguments, or provider attempt paths.
- The disclosure is collapsed by default: while active its summary shows only the current stage, safe query, and source count; a run transition to terminal collapses it once. Sources are a separate disclosure below the semantic timeline, never an execution step.

## 4. Validation & Error Matrix

| Condition | Process result | Answer result |
| --- | --- | --- |
| Strict start fails | No trace run | Existing `start_failed` terminal |
| Out-of-order, duplicate, or cross-run event | Reducer ignores it | Stream continues |
| Event contains an extra/sensitive field | SSE parser rejects protocol | Message becomes interrupted |
| Trace emitter fails | Recorder counts/logs safe failure | Generation continues |
| Completion persistence fails | Live process converges to failed; no fake snapshot | `persistence_failed` terminal |
| Client Abort | Running steps and phase converge to interrupted | Partial content is preserved |
| Continue succeeds | Existing runs plus the new run | Same assistant row is updated |

## 5. Good / Base / Bad Cases

- Good: memory, prompt, reasoning, Web Search, sources, and tools appear under one disclosure before the answer.
- Good: two Web Search calls update separate steps by `toolCallId` and preserve their own backend/citations.
- Base: an old message without `process` still renders the legacy reasoning/tool/source projection.
- Bad: infer the whole process status from `content` or `isStreaming` when a server phase exists.
- Bad: persist only the latest continue run or copy tool/search payloads into the process snapshot.

## 6. Tests Required

- Contract guards reject invalid version/status/seq and extra sensitive fields.
- Recorder tests cover monotonic seq, phase non-regression, terminal step convergence, projected snapshots, and emitter failure.
- Coordinator tests assert strict start precedes trace/model work and `answering` precedes the first non-empty text delta.
- SSE tests cover valid trace frames, invalid frames, terminal-after-trace, and terminal fallback convergence.
- Store tests cover send, regenerate, edit-and-resend, continue, multi-run preservation, Abort, and failure.
- History/version tests assert snapshot round-trip and selected-version isolation.
- Component/model tests cover semantic step grouping, hidden internal details, current-stage summaries, terminal auto-collapse, partial-source warning, legacy fallback, independent sources, keyboard disclosure, and reduced motion.

## 7. Wrong vs Correct

```ts
// Wrong: render backend implementation details as a debug log.
const event = raw as { phase?: string; prompt?: string };
return steps.map((step) => <Row>{step.kind}: {JSON.stringify(step.data)}</Row>);

// Correct: keep lifecycle canonical, then project it into user semantics.
const runtime = reduceChatProcessEvent(previous, event);
const research = buildResearchStatus({
  phase: runtime.phase,
  canonicalSteps: runtime.steps,
  toolCalls,
  sourceCount: searchResults.length,
  content,
  hasReasoning: Boolean(reasoning),
  startedAt: runtime.startedAt,
  endedAt: runtime.endedAt,
});
```
