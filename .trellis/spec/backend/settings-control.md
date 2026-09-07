# Settings Control Plane

## Scenario: Immediate Settings Saves, Legacy Drafts, And Reversal

### 1. Scope / Trigger

Apply this contract when changing system-setting writes, output mode/style
mutations, settings history, rollback, runtime settings caches, or the settings
control PostgreSQL schema. `user_settings` is not part of this control plane.

### 2. Signatures

```typescript
interface SettingsSaveResult {
  revision: number;
  changeSetId: string | null; // null means unchanged
}

// Only for explicitly handling legacy drafts.
interface SettingsDraftExpectation {
  changeSetId: string | null;
  version: number | null;
}

type SettingsChange =
  | { resource: "system_setting"; resourceKey: `system:${string}:${string}`;
      before: SystemSettingSnapshot | null; after: SystemSettingSnapshot | null }
  | { resource: "output_mode"; resourceKey: `output-mode:${string}`;
      before: OutputModeSnapshot | null; after: OutputModeSnapshot | null }
  | { resource: "render_style"; resourceKey: `render-style:${string}`;
      before: RenderStyleSnapshot | null; after: RenderStyleSnapshot | null };

getSettingsControlView(): Promise<SettingsControlView>;
getSettingsRevision(): Promise<number>;
saveSystemSettings(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveOutputModeCreate(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveOutputModeUpdate(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveOutputModeDelete(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveOutputModeReorder(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveRenderStyleCreate(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveRenderStyleUpdate(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveRenderStyleDelete(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
saveRenderStyleReorder(input: { actorId: string; expected: number; /* resource fields */ }): Promise<SettingsSaveResult>;
abandonSettingsDraft(input): Promise<void>;
applySettingsDraft(input): Promise<{ revision: number; changeSetId: string }>;
listSettingsHistory(limit?: number): Promise<SettingsHistoryEntry[]>;
rollbackSettings(input: { actorId: string; expected: number; targetChangeSetId: string }): Promise<SettingsSaveResult>;
```

PostgreSQL facts:

- `settings_control_state(id='global', current_revision bigint)` is the global
  lock and monotonic cache generation.
- `settings_change_sets` stores `draft | applied | abandoned`, `edit | rollback`,
  actor, base/applied revision, optimistic `version`, and JSONB `changes`.
- A partial unique index permits at most one global `status='draft'` row.
- An applied-history trigger rejects later `UPDATE` or `DELETE` with SQLSTATE
  `55000`.

### 3. Contracts

- Every public Server Action authenticates with `requireAdmin`; domain calls
  receive the authenticated administrator ID. Clients never supply `before`,
  a trusted diff, actor identity, or the next revision.
- `changeSetId` and `version` are either both null or both present. Existing
  drafts require the exact actor, ID, and safe-integer version. A stale tab must
  fail instead of overwriting the current draft.
- Daily saves require a nonnegative safe-integer production revision in
  `expected`. Lock the control row and compare it before deriving changes from
  production values (never from a legacy draft). Validate and write settings,
  increment revision, and insert immutable applied history in one transaction.
  Unchanged saves return the current revision and `changeSetId: null`, without
  writing history or advancing revision.
- Read the production revision before loading form values. Never bind a newer
  token to values loaded before that token. Daily forms do not project drafts.
- Existing drafts are neither published nor deleted by daily saves or reversal.
  Expose their explicit review/apply/abandon operations only as legacy recovery.
- One change exists per stable `resourceKey`. Create is `null -> value`, delete
  is `value -> null`, and reorder is a `sortOrder` field change. Reorder input
  must contain every current resource ID exactly once.
- Merge input may be `null -> null` when a form clears an absent legacy key:
  ignore it, or remove a staged creation that returns to its original absence.
  Persisted changes must still reject both-null snapshots. Tests must cover
  absent-key clearing alongside a real edit, not only populated fixtures.
- Apply locks the control row and draft, re-reads every production resource, and
  requires it to equal the persisted `before`. It validates the complete
  projected state before writing, then performs deletes, updates, creates, the
  revision increment, and `draft -> applied` in one PostgreSQL transaction.
  Any error rolls back production rows, revision, and history status together.
- All save/reversal functions and `applySettingsDraft` own only the database transaction. Their callers must run
  the single runtime invalidator only after the promise resolves. Cache cleanup
  failure must not turn into a save error: `refreshSettings` returns a warning
  and logs a non-sensitive message; history actions surface
  `applied_cache_warning`. The database remains committed, and revision-aware
  readers converge on the next read. All reset calls are isolated by allSettled.
- Applied rows are immutable. History is ordered by `applied_revision`; the
  public limit is a safe integer from 1 through 100.
- Reversal requires the expected production revision and an applied target. It derives changed
  fields from the target's complete before/after snapshots. Create/delete uses
  the entity wildcard `*`; update/reorder uses only actually changed fields.
  Any later overlapping change or current-value mismatch returns structured
  conflicts and creates nothing.
- A successful reversal directly commits a new applied `kind='rollback'` history
  record. It never edits existing history. The UI must show affected fields and
  require confirmation before submission; loading history and previewing
  reversal are read-only and authenticated. History is loaded only on request.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing actor, invalid revision, or malformed legacy expectation | `SettingsValidationError` |
| Production revision or legacy draft ID/version/actor is stale | `SettingsDraftConflictError` |
| Empty draft apply | `SettingsValidationError`; no revision change |
| Production snapshot differs from persisted `before` | Conflict; no writes |
| Unsupported system key or invalid governance JSON | Validation error before apply |
| Model/provider reference is not owned, enabled, and routable | Validation error before apply |
| Output resource missing, duplicate order, or incomplete order | Validation error |
| Built-in render style CSS identity changed or deleted | Validation error |
| Any projected-state or database write fails | Entire transaction rolls back |
| Rollback target is not applied or has no reversible changes | Validation error |
| Later publication overlaps target fields, or current value differs | `SettingsRollbackConflictError`; no writes |
| Runtime invalidation fails after commit | Warning; do not report rollback |
| Applied history is updated or deleted | PostgreSQL SQLSTATE `55000` |

### 5. Good / Base / Bad Cases

- Good: one form save updates both User-Agents in one transaction, immediately
  producing one revision/history record or writing nothing on failure.
- Good: reversing an old field-only update restores only those fields and keeps
  later non-overlapping fields unchanged.
- Base: repeated edits to one resource keep its original `before` and latest
  `after`; editing back to the original removes that change.
- Bad: calling three legacy write actions serially can leave partial production
  state and history that does not describe reality.
- Bad: resetting caches inside the transaction creates a non-rollbackable side
  effect if a later SQL statement fails.
- Bad: restoring a whole historical snapshot silently overwrites unrelated
  changes made by later revisions.

### 6. Tests Required

- Change logic tests assert strict snapshot parsing, stable resource keys,
  duplicate/no-op rejection, first-before/latest-after merge, field overlap,
  wildcard create/delete reversal, and field-only reversal.
- Service tests assert stale and concurrent revision rejection, no-op saves,
  supported system keys, resource validation, exact reorder sets, history
  limits, and isolation from existing legacy drafts.
- Real PostgreSQL tests must save system settings, output modes, and render
  styles; force validation and final-history-write failure and assert production,
  revision, and history are unchanged; verify exactly one concurrent save wins.
- Migration/PostgreSQL tests assert the global singleton, partial draft index,
  state/time checks, applied revision uniqueness, and immutable-history trigger.
- Rollback tests cover create/delete/update/reorder, later same-field conflict,
  later non-overlapping preservation, current-value mismatch, and re-apply as a
  new immediately effective revision.
- Runtime tests assert no invalidation on failed apply, invalidation only after
  commit, revision-aware cache refresh across processes, and warning semantics
  when best-effort cleanup fails.

### 7. Wrong vs Correct

```typescript
// Wrong: separate stage/apply calls can leave a draft behind on failure.
const draft = await stageSettings(values);
await applySettingsDraft({ actorId, expected: draft });

// Correct: one transaction; pre-existing drafts remain untouched.
const saved = await saveSystemSettings({ actorId, expected: revision, namespace, values });
await refreshSettings(saved);
```

```typescript
// Wrong: an external side effect runs before the database outcome is durable.
await db.transaction(async () => {
  await applyDraftRows();
  await invalidateSettingsRuntime(previousRevision);
});

// Correct: the transaction resolves first; cleanup cannot rewrite its outcome.
const applied = await applySettingsDraft({ actorId, expected });
const warning = await invalidateSettingsRuntime(applied.revision - 1);
```
