# Chat Run Metadata

## 1. Scope / Trigger

Apply this contract when changing authenticated chat run completion, `runs` usage/timing columns, the WebChat `finish` SSE event, historical message projections, or assistant metadata UI. The goal is to expose one privacy-safe run projection without duplicating facts onto messages or public shares.

## 2. Signatures

- Database: `messages.run_id -> runs.run_id`; `runs.duration_ms integer NULL`; `runs.completed_at timestamptz NULL`.
- Runtime finalization: `finalizeRun({ runId, status, tokenUsage?, durationMs?, completedAt? })`.
- Shared DTO:
  ```typescript
  interface MessageRunMetadata {
    model?: string;
    tokenUsage?: TokenUsage;
    durationMs?: number;
    completedAt?: string;
  }
  ```
- SSE: `data: {"type":"finish","metadata":MessageRunMetadata}` immediately before `data: [DONE]`.
- Client parser: `SSEHandlers.onFinish?: (metadata: MessageRunMetadata) => void`.
- Historical loader: `loadRunMetadataByRunIds(db, schema, conversationId, runIds)` returns a run-ID map.

## 3. Contracts

- `runs` is the only run-metadata fact source. Do not copy model or usage into `messages`, and do not reconstruct message metadata from `usage_logs`.
- Model means `runs.platformModelName`, not provider, routed binding, upstream model, key, or failover details.
- `durationMs` is the non-negative wall-clock interval from `/api/chat` request entry through required assistant persistence. `completedAt` and `durationMs` are computed once after that persistence, then the same values enter `finalizeRun` and the SSE DTO.
- Final usage comes from the normalized upstream finish usage. Missing token subfields stay missing; numeric zero is valid data. Cache/reasoning tokens are not re-added into a synthetic total.
- Required assistant persistence is the success gate. The route awaits the bounded run-finalize attempt, sends one `finish` frame, then sends `[DONE]`. A required persistence failure sends an error and suppresses both success signals.
- `finalizeRun` updates only `runId + status='running'` and writes terminal status, usage, duration, and completion time in one update. Its existing best-effort timeout remains non-fatal to an already persisted assistant.
- Live send, regenerate, edit-resend, and continue all consume `onFinish`. New generations clear stale metadata; continue overwrites the same assistant with the latest run metadata; version switching replaces the entire projection.
- Historical main-branch and sibling queries batch run IDs and require both `runs.conversationId = authorizedConversationId` and `runId IN (...)`. Dates cross the Client Component boundary as ISO strings.
- Nullable legacy fields degrade independently. Do not render placeholders for unknown values. Use the active UI locale for token number formatting; time remains on the shared `formatDateTimeLocal` contract.
- Public share actions, snapshots, and `ReadonlyChatMessage` must not add `MessageRunMetadata`.
- Server-side `ProcessTrace` construction and `messages.processTrace` persistence remain independent diagnostics. Ordinary WebChat SSE and `ChatMessage` do not carry trace.
- Schema changes append a PostgreSQL migration plus Drizzle journal and snapshot; published migration artifacts are immutable.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Upstream omits cache/reasoning usage | Omit that field; never display `0` |
| Upstream reports a real numeric `0` | Preserve and display `0` |
| Legacy run has null duration/completion | Preserve available model/usage; omit null fields |
| Required assistant persistence fails | Error SSE; no `finish`; no `[DONE]`; failed run finalization |
| Best-effort run finalization fails after assistant persistence | Live finish may still succeed; refresh may lack audit metadata |
| Requested run belongs to another conversation | Exclude it through the conversation-scoped query |
| Assistant is interrupted | No successful finish metadata; UI keeps the continuation action |
| Public share is read anonymously | Return only the established public message projection |

## 5. Good / Base / Bad Cases

- Good: one completed assistant receives the same ISO completion time and duration live, after refresh, and after version switching.
- Good: a continuation clears old metadata while streaming and replaces it with the continuation run on finish.
- Base: an old run with only model and aggregate prompt/completion usage renders only those known fields.
- Base: a model that reports cache or reasoning token `0` renders the explicit zero.
- Bad: using browser elapsed time or a single `usage_logs.latencyMs` as the whole-run duration.
- Bad: selecting a complete run row for the client or omitting the conversation predicate because run IDs are globally unique.
- Bad: sending metadata as soon as the provider emits finish, before assistant persistence has succeeded.
- Bad: adding run metadata to the share DTO for display convenience.

## 6. Tests Required

- Schema/migration tests assert nullable integer/timestamptz columns, appended journal ordering, and snapshot `prevId` continuity.
- Run-lifecycle tests assert one update writes status, normalized usage, duration, and completion time under the `status='running'` predicate.
- `/api/chat` tests assert required persistence -> finalize attempt -> `finish` -> `[DONE]`, value identity between finalize/SSE, persistence-failure suppression, and absence of trace SSE.
- SSE parser tests assert typed `finish` dispatch and reliable `[DONE]` termination.
- Store tests cover send, regenerate, edit-resend, continue, and version replacement, including stale metadata clearing.
- Branch tests assert batched metadata projection, ISO dates, nullable degradation, real zero preservation, and conversation scoping for both visible branches and siblings.
- Component tests assert field order, missing-vs-zero behavior, long-model truncation/title, and accessible coarse-pointer expansion state.
- Browser checks cover fine-pointer hover/focus without geometry movement, 320/390px coarse-pointer expansion with a 44px target and zero horizontal overflow, plus light/dark themes.
- Existing public-share tests must continue to prove that readonly messages contain no run metadata.

## 7. Wrong vs Correct

```typescript
// Wrong: provider finish occurs before required persistence is known to be successful.
enqueue({ type: "finish", metadata: buildMetadata() });
await persistAssistant();

// Correct: persist first, compute once, finalize the run, then signal success.
await persistAssistant();
const completedAt = new Date();
const durationMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
await finalizeRun({ runId, status, tokenUsage, durationMs, completedAt });
enqueue({ type: "finish", metadata: { model, tokenUsage, durationMs, completedAt: completedAt.toISOString() } });
enqueue("[DONE]");
```

```typescript
// Wrong: a globally unique run ID is treated as authorization.
where(inArray(runs.runId, runIds));

// Correct: project only runs from the already-authorized conversation.
where(and(
  eq(runs.conversationId, conversationId),
  inArray(runs.runId, runIds),
));
```
