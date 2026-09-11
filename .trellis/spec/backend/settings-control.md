# Settings Control Plane

## Scenario: Immediate Settings Saves

### 1. Scope / Trigger

Applies to system-setting writes, output mode/style mutations, runtime caches,
and their PostgreSQL schema. `user_settings` is separate.

### 2. Signatures

```typescript
interface SettingsSaveResult {
  revision: number;
  changed: boolean;
}

getSettingsControlView(): Promise<{ currentRevision: number }>;
getSettingsRevision(): Promise<number>;
saveSystemSettings(input: { actorId: string; expected: number; namespace: string; values: Record<string, string> }): Promise<SettingsSaveResult>;
// Output mode/style create/update/delete/reorder use the same actorId,
// expected production revision, and SettingsSaveResult contract.
```

`system_settings`, `output_modes`, and `render_styles` hold effective values.
`settings_control_state(id='global', current_revision)` holds the serialization
lock and monotonic cache generation. There is no settings draft/history table.

### 3. Contracts

- Settings take effect upon saving. Do not retain draft, history, review/publish,
  or reversal features. Remove their UI, actions, DTOs, storage, and messages together.
- Every Server Action authenticates with `requireAdmin`; the service receives
  that actor ID. Clients never supply actor identity or trusted before snapshots.
- Read revision before form values. Saves require a nonnegative safe-integer
  `expected`; lock the global row and reject stale revisions before deriving changes.
- Validate the complete proposed state, write resources, and advance revision
  in one transaction. Any failure leaves configuration and revision unchanged.
- Unchanged saves return `{ revision, changed: false }` without writes. Actual
  saves return the next revision and `changed: true`. No history is written.
- Before/after snapshots exist only in the transaction for validation, no-op
  detection, and write ordering. Never persist them as audit history.
- Resource keys are stable. Duplicate/empty changes are invalid; clearing an
  absent setting is a no-op. Reorders include every current ID exactly once.
  Built-in styles cannot be deleted or change CSS identity.
- Call `refreshSettings` only after commit. It invalidates the previous cache
  generation only when `changed` is true, then refreshes the page. Cleanup
  failure returns a warning; revision-aware readers converge on the next read.
- Migration 0002 removes history table/function/enum and preserves effective
  settings and revision. Executed migrations remain unchanged; baseline object
  lists describe migration 0000, not the schema after all migrations.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing actor or invalid revision | `SettingsValidationError` |
| Stale revision | `SettingsConflictError`; no writes |
| Unsupported key, invalid governance JSON, or invalid provider/model reference | Validation failure; no writes |
| Missing output resource or duplicate/incomplete reorder | Validation failure |
| Built-in style deleted or CSS identity changed | Validation failure |
| Validation or database write fails | Whole transaction rolls back |
| Unchanged effective values | `changed: false`; same revision |
| Cache invalidation fails after commit | Warning; save remains effective |

### 5. Good / Base / Bad Cases

- Good: save both User-Agent values and revision atomically.
- Base: unchanged values neither advance revision nor invalidate caches.
- Bad: retain a history button or historical snapshots after the product
  explicitly adopts an immediate-save-only workflow.
- Bad: reset caches inside a transaction that can still fail.

### 6. Tests Required

- Parsing/merge tests: stable keys, empty/duplicate changes, clearing absent
  values, first-before/latest-after merge, and restoration to original values.
- Real PostgreSQL: system/mode/style saves with no history table, stale and
  concurrent rejection, no-op saves, validation failure, and late revision-write
  failure rolling back earlier configuration writes.
- Migration: SQL/journal/snapshot agreement, removed table/function/enum,
  preserved effective values and revision.
- Cache: no invalidation for no-op saves, previous-generation invalidation for
  actual saves, and warning behavior after commit.

### 7. Wrong vs Correct

```typescript
// Wrong: cache state changes before the transaction is durable.
await db.transaction(async () => {
  await writeSettingsRows();
  await invalidateSettingsRuntime(previousRevision);
});

// Correct: transaction first, then refresh using its changed flag.
const saved = await saveSystemSettings({ actorId, expected: revision, namespace, values });
await refreshSettings(saved);
```
