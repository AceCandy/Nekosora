# Settings Control Plane

## Scenario: Atomic Settings Drafts, Publishing, And Reversal

### 1. Scope / Trigger

Apply this contract when changing system-setting writes, output mode/style
mutations, settings history, rollback, runtime settings caches, or the settings
control PostgreSQL schema. `user_settings` is not part of this control plane.

### 2. Signatures

```typescript
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
stageSystemSettings(input): Promise<SettingsDraftView>;
stageOutputModeCreate(input): Promise<SettingsDraftView>;
stageOutputModeUpdate(input): Promise<SettingsDraftView>;
stageOutputModeDelete(input): Promise<SettingsDraftView>;
stageOutputModeReorder(input): Promise<SettingsDraftView>;
stageRenderStyleCreate(input): Promise<SettingsDraftView>;
stageRenderStyleUpdate(input): Promise<SettingsDraftView>;
stageRenderStyleDelete(input): Promise<SettingsDraftView>;
stageRenderStyleReorder(input): Promise<SettingsDraftView>;
abandonSettingsDraft(input): Promise<void>;
applySettingsDraft(input): Promise<{ revision: number; changeSetId: string }>;
listSettingsHistory(limit?: number): Promise<SettingsHistoryEntry[]>;
createRollbackDraft(input): Promise<SettingsDraftView>;
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
- All stage operations lock `settings_control_state` and the active draft in one
  transaction. The server loads the production/projected resource, derives the
  canonical before/after snapshots, keeps the first `before`, replaces only the
  latest `after`, and removes a resource change that returns to its original
  value.
- One change exists per stable `resourceKey`. Create is `null -> value`, delete
  is `value -> null`, and reorder is a `sortOrder` field change. Reorder input
  must contain every current resource ID exactly once.
- Apply locks the control row and draft, re-reads every production resource, and
  requires it to equal the persisted `before`. It validates the complete
  projected state before writing, then performs deletes, updates, creates, the
  revision increment, and `draft -> applied` in one PostgreSQL transaction.
  Any error rolls back production rows, revision, and history status together.
- `applySettingsDraft` owns only the database transaction. Its caller must run
  the single runtime invalidator only after the promise resolves. Cache cleanup
  failure is an `applied_cache_warning`: the database publication remains
  committed, and revision-aware readers converge on the next read.
- Applied rows are immutable. History is ordered by `applied_revision`; the
  public limit is a safe integer from 1 through 100.
- Reversal requires no active draft and an applied target. It derives changed
  fields from the target's complete before/after snapshots. Create/delete uses
  the entity wildcard `*`; update/reorder uses only actually changed fields.
  Any later overlapping change or current-value mismatch returns structured
  conflicts and creates nothing.
- A successful reversal creates a new `kind='rollback'` draft at the current
  revision. It never edits history or production directly and must pass the
  normal review and atomic apply path.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing actor, half-null expectation, or invalid version | `SettingsValidationError` |
| Draft ID/version/actor is stale, missing, or mismatched | `SettingsDraftConflictError` |
| Empty draft apply | `SettingsValidationError`; no revision change |
| Production snapshot differs from persisted `before` | Conflict; no writes |
| Unsupported system key or invalid governance JSON | Validation error before apply |
| Model/provider reference is not owned, enabled, and routable | Validation error before apply |
| Output resource missing, duplicate order, or incomplete order | Validation error |
| Built-in render style CSS identity changed or deleted | Validation error |
| Any projected-state or database write fails | Entire transaction rolls back |
| Rollback target is not applied or has no reversible changes | Validation error |
| Later publication overlaps target fields, or current value differs | `SettingsRollbackConflictError`; no draft |
| Runtime invalidation fails after commit | Warning; do not report rollback |
| Applied history is updated or deleted | PostgreSQL SQLSTATE `55000` |

### 5. Good / Base / Bad Cases

- Good: one draft changes a User-Agent, creates an output mode, and reorders a
  render style; one apply produces one revision or writes nothing.
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
- Service tests assert one active draft, optimistic version conflicts, supported
  system keys, resource validation, exact reorder sets, and history limit bounds.
- Real PostgreSQL tests must publish system settings, output modes, and render
  styles together; force projected validation/write failure and assert production,
  revision, and draft status are unchanged; verify concurrent apply behavior.
- Migration/PostgreSQL tests assert the global singleton, partial draft index,
  state/time checks, applied revision uniqueness, and immutable-history trigger.
- Rollback tests cover create/delete/update/reorder, later same-field conflict,
  later non-overlapping preservation, current-value mismatch, and re-apply as a
  new revision.
- Runtime tests assert no invalidation on failed apply, invalidation only after
  commit, revision-aware cache refresh across processes, and warning semantics
  when best-effort cleanup fails.

### 7. Wrong vs Correct

```typescript
// Wrong: bypasses one revision, one history record, and atomic rollback.
await saveSystemSettings(values);
await updateOutputMode(mode);
await reorderRenderStyles(ids);

// Correct: every mutation stages into the same server-owned draft.
await stageSystemSettings({ actorId, expected, namespace, values });
await stageOutputModeUpdate({ actorId, expected: nextExpected, ...mode });
await stageRenderStyleReorder({ actorId, expected: latestExpected, orderedIds: ids });
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
