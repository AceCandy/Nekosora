# Instruction Cards

## Scenario: Per-user instruction card ownership

### 1. Scope / Trigger

- Applies when changing instruction-card storage, CRUD actions, chat selection, caching, or the `/panel/cards` manager.
- Instruction cards are user-owned prompt fragments, not administrator presets or globally shared resources.

### 2. Signatures

- Database: `instruction_cards.user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE`; there is no visibility or scope column.
- DTO: `InstructionCard.userId: string`; there is no `CardScope`.
- Reads: `listCards(userId)` and `getCardsByIds(userId, ids)`.
- Writes: `createCard(userId, input)`, `updateCard(userId, id, patch)`, and `deleteCard(userId, id)`.

### 3. Contracts

- Every list or ID-based read must include `instruction_cards.user_id = userId`; `enabled = true` is an additional selection condition, not an authorization substitute.
- Server Actions call `requireSession()` and pass that session user ID to the service. Client input never supplies an owner or visibility value.
- Chat resolves submitted card IDs through `getCardsByIds(userId, ids)` before rendering or incrementing use counts, so another user's ID cannot inject prompt content.
- `/panel/cards` only displays cards returned for the current user. It has no shared/private selector, built-in badge, or read-only administrator card state.
- The ownership migration keeps rows with a user ID, removes legacy ownerless rows, then makes `user_id` non-null and removes the legacy `scope` column.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Own enabled card | Returned by list and ID lookup |
| Another user's card ID | Omitted from lookup; never rendered into chat |
| Disabled own card | Omitted from list and ID lookup |
| Empty ID list | Return `[]` without querying |
| Update/delete another user's card | Reject before the write |
| Delete missing card | Idempotent success |
| Legacy row with null user ID | Deleted before `user_id` becomes non-null |

### 5. Good / Base / Bad Cases

- Good: a user submits a mixed list of own and foreign card IDs; only owned enabled cards reach `renderCardContext`.
- Base: a user creates, edits, disables, or deletes one of their own cards without choosing a visibility setting.
- Bad: treating a valid session as authorization for an arbitrary card ID, or restoring `builtin` / `shared` branches in list queries or UI.

### 6. Tests Required

- Service tests assert both list and ID lookup predicates contain the current user ID, and that foreign-card mutation is rejected before update/delete.
- Migration tests assert ownerless-row deletion precedes the non-null constraint, `scope` and its index are removed, and journal/snapshot IDs remain continuous.
- Web typecheck and i18n key checks ensure removed visibility fields and labels have no remaining consumers.

### 7. Wrong vs Correct

```typescript
// Wrong: global scopes make another user's prompt content visible.
or(eq(cards.scope, "builtin"), eq(cards.scope, "shared"))

// Correct: ownership is the authorization boundary for every card read.
and(eq(cards.enabled, true), eq(cards.userId, userId))
```
