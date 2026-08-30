# API Key Binding Authorization

## 1. Scope / Trigger

Apply this contract to panel server actions that read or mutate API keys and `key_model_bindings`. A valid web session authenticates the caller but does not authorize a client-supplied key, binding, or model ID.

## 2. Signatures

- `disableKey(keyId): Promise<void>`
- `getBindings(keyId): Promise<KeyModelBinding[]>`
- `bindModels(keyId, modelIds: string[]): Promise<void>`
- `unbindBinding(bindingId): Promise<void>`
- `POST /v1/mcp` with `tools/call: list_models`
- `setKeyEnabled(userId, keyId, enabled): Promise<void>`
- `requireOwnedKey(db, userId, keyId, subOnly?): Promise<ApiKey>`

## 3. Contracts

- Every key lookup combines `api_keys.id = keyId` with `api_keys.user_id = session.user.id`.
- `disableKey` verifies ownership before calling the low-level `setKeyEnabled` helper, and the helper repeats `api_keys.user_id = userId` in the update itself.
- `getBindings` verifies key ownership before returning binding rows.
- `bindModels` accepts a non-empty model ID array and only a caller-owned `kind='sub'` key. It trims and deduplicates IDs before querying.
- Every requested model must be enabled and owned by the caller. Public visibility affects WebChat, not gateway key authorization. This must match `getBindableModels`; if the authorized query returns fewer rows than requested, reject before insert.
- A valid batch is written with one multi-row insert. `(key_id, model_id)` uniqueness plus `onConflictDoNothing()` makes concurrent repeat binding idempotent without partial writes.
- `unbindBinding` resolves the binding's `keyId`, verifies ownership of that key, and only then deletes the binding.
- Master and sub keys are flat permission roles under the same user, not a database parent/child hierarchy. Sub-key authorization is keyed by the sub key's own ID and `key_model_bindings` rows.
- Revoking a master key disables only that key; existing sub keys remain independently valid.
- Regenerating a revoked master key rotates the same row in place with an owner-scoped `kind='master' AND enabled=false` update. Return the new plaintext only after the update succeeds so the single-master record remains stable under concurrent rotation.
- Creating a sub key requires an enabled master key.
- New keys store only `first 8 + **** + last 4` in `key_prefix`; verification also accepts the legacy `first 8 + …` format. Partial key previews are display-only and must not expose a copy action.
- `key_prefix` has a PostgreSQL B-tree index for authentication candidate lookup. Key-management lists use an explicit DTO projection and never query or serialize `key_hash`.
- `getBindableModels` selects only `id`, `name`, and `displayName`; the Key page reconstructs the same DTO before Client props. Model `systemPrompt`, `description`, owner fields, and timestamps must not enter the RSC payload.
- Model-list endpoints are authorization surfaces: MCP `list_models` returns all enabled owner models for a master key, but joins `key_model_bindings` for a sub key and returns only rows bound to `ctx.apiKeyId`.
- Authorization failures occur before insert, update, or delete. UUID foreign keys and UI filtering are not authorization controls.

## 4. Validation & Error Matrix

| Operation | Required authorization | Invalid result |
| --- | --- | --- |
| Disable key | `key.userId === session.user.id` | Throw before update |
| Persist key status | Key ID + user ID in one update condition | Update zero foreign rows |
| Read bindings | `key.userId === session.user.id` | Throw before returning rows |
| Bind models | Non-empty IDs + owned sub key + every model enabled and owner-scoped | Reject the whole batch before insert |
| Unbind model | Binding references an owned key | Throw before delete |
| MCP model list | Owner + enabled; sub key also bound | Omit unbound models |

## 5. Good / Base / Bad Cases

- Good: the caller's enabled public and private models can be bound to their sub key in one batch.
- Base: owners can read bindings and disable their own master or sub key.
- Base: a master key's MCP model list contains all enabled owner models; an unbound sub key returns `无可用模型`.
- Bad: `requireSession()` followed by a global key or binding ID write lets any user mutate another user's gateway authorization.
- Bad: validating or inserting each model in a loop can leave a partially written batch when a later model is unauthorized.
- Bad: treating public visibility as gateway authorization lets a user bind another owner's model even though `/v1/*` is owner-only.

## 6. Tests Required

- Reject disabling and reading bindings for a foreign key.
- Reject binding to a foreign key or a master key without calling insert.
- Reject an empty batch and another user's public or private model without calling insert.
- Accept multiple caller-owned enabled models in one insert, deduplicate repeated IDs, and ignore concurrent duplicate conflicts.
- Reject a mixed valid/invalid batch before insert so no partial binding is written.
- Reject deleting a binding whose key belongs to another user without calling delete.
- Keep positive owner tests for key disable and binding reads.
- Low-level key tests assert `setKeyEnabled` combines key ID and user ID in the update predicate.
- Master-key lifecycle tests cover revoked-key rotation, concurrent rotation rejection, and disabled-master rejection for new sub keys.
- Key-preview tests cover masked persistence, legacy verification, and the absence of partial-value copy controls.
- Key-list and RSC boundary tests assert that `key_hash` and storage-only fields never reach Client Component props.
- Bindable-model action and Key-page tests seed storage-only model fields and assert both the action result and Client props contain only `id`, `name`, and `displayName`.
- MCP route tests cover master-key owner filtering, sub-key binding join conditions, and an empty binding set.
- Run lint, typecheck, full tests, production build, and diff checks.

## 7. Wrong vs Correct

```typescript
// Wrong:per-model writes can partially persist before a later authorization failure.
for (const modelId of modelIds) {
  await db.insert(s.keyModelBindings).values({ keyId, modelId });
}

// Correct:authorize the key and the complete model set before one multi-row insert.
const user = await requireSession();
await requireOwnedKey(db, user.id, keyId, true);
const uniqueModelIds = [...new Set(modelIds)];
const models = await db.select({ id: s.models.id }).from(s.models)
  .where(and(
    inArray(s.models.id, uniqueModelIds),
    eq(s.models.enabled, true),
    eq(s.models.ownerUserId, user.id),
  ));
if (models.length !== uniqueModelIds.length) throw new Error("模型不存在或无权操作");
await db.insert(s.keyModelBindings)
  .values(uniqueModelIds.map((modelId) => ({ keyId, modelId })))
  .onConflictDoNothing();
```

```typescript
// Wrong:sub keys can enumerate every model owned by the user.
await db.select().from(s.models)
  .where(and(eq(s.models.ownerUserId, ctx.userId), eq(s.models.enabled, true)));

// Correct:sub-key enumeration follows the same binding edge as routing.
await db.select().from(s.keyModelBindings)
  .innerJoin(s.models, eq(s.keyModelBindings.modelId, s.models.id))
  .where(and(
    eq(s.keyModelBindings.keyId, ctx.apiKeyId),
    eq(s.models.ownerUserId, ctx.userId),
    eq(s.models.enabled, true),
  ));
```

```typescript
// Wrong:a reusable write helper trusts global key IDs.
await db.update(s.apiKeys).set({ enabled })
  .where(eq(s.apiKeys.id, keyId));

// Correct:the data write remains owner-scoped even after action authorization.
await db.update(s.apiKeys).set({ enabled })
  .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.userId, userId)));
```

```typescript
// Wrong:a bindable dropdown does not need the complete model storage row.
await db.select().from(s.models);

// Correct:query only the fields that cross the Server-to-Client boundary.
await db.select({
  id: s.models.id,
  name: s.models.name,
  displayName: s.models.displayName,
}).from(s.models);
```
