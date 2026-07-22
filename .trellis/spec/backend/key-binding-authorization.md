# API Key Binding Authorization

## 1. Scope / Trigger

Apply this contract to panel server actions that read or mutate API keys and `key_model_bindings`. A valid web session authenticates the caller but does not authorize a client-supplied key, binding, or model ID.

## 2. Signatures

- `disableKey(keyId): Promise<void>`
- `getBindings(keyId): Promise<KeyModelBinding[]>`
- `bindModel(keyId, modelId): Promise<void>`
- `unbindBinding(bindingId): Promise<void>`
- `requireOwnedKey(db, userId, keyId, subOnly?): Promise<ApiKey>`

## 3. Contracts

- Every key lookup combines `api_keys.id = keyId` with `api_keys.user_id = session.user.id`.
- `disableKey` verifies ownership before calling the low-level `setKeyEnabled` helper.
- `getBindings` verifies key ownership before returning binding rows.
- `bindModel` accepts only a caller-owned `kind='sub'` key.
- A bindable model is enabled and either public or owned by the caller. This must match `getBindableModels`.
- `unbindBinding` resolves the binding's `keyId`, verifies ownership of that key, and only then deletes the binding.
- Authorization failures occur before insert, update, or delete. UUID foreign keys and UI filtering are not authorization controls.

## 4. Validation & Error Matrix

| Operation | Required authorization | Invalid result |
| --- | --- | --- |
| Disable key | `key.userId === session.user.id` | Throw before update |
| Read bindings | `key.userId === session.user.id` | Throw before returning rows |
| Bind model | Owned sub key + enabled public/owned model | Throw before insert |
| Unbind model | Binding references an owned key | Throw before delete |

## 5. Good / Base / Bad Cases

- Good: a public enabled model can be bound to the caller's sub key.
- Good: the caller's enabled private model can be bound to their sub key.
- Base: owners can read bindings and disable their own master or sub key.
- Bad: `requireSession()` followed by a global key or binding ID write lets any user mutate another user's gateway authorization.
- Bad: trusting an arbitrary `modelId` lets a user bind another user's private model, which downstream routing treats as authorized.

## 6. Tests Required

- Reject disabling and reading bindings for a foreign key.
- Reject binding to a foreign key or a master key without calling insert.
- Reject another user's private model without calling insert.
- Accept an enabled public model and the caller's enabled private model.
- Reject deleting a binding whose key belongs to another user without calling delete.
- Keep positive owner tests for key disable and binding reads.
- Run lint, typecheck, full tests, production build, and diff checks.

## 7. Wrong vs Correct

```typescript
// Wrong:a session does not prove ownership of keyId.
await requireSession();
await db.insert(s.keyModelBindings).values({ keyId, modelId });

// Correct:authorize both the key and model before creating an authorization edge.
const user = await requireSession();
await requireOwnedKey(db, user.id, keyId, true);
const [model] = await db.select({ id: s.models.id }).from(s.models)
  .where(and(
    eq(s.models.id, modelId),
    eq(s.models.enabled, true),
    or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, user.id)),
  ))
  .limit(1);
if (!model) throw new Error("模型不存在或无权操作");
```
