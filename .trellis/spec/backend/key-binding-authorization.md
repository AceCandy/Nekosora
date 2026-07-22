# API Key Binding Authorization

## 1. Scope / Trigger

Apply this contract to panel server actions that read or mutate API keys and `key_model_bindings`. A valid web session authenticates the caller but does not authorize a client-supplied key, binding, or model ID.

## 2. Signatures

- `disableKey(keyId): Promise<void>`
- `getBindings(keyId): Promise<KeyModelBinding[]>`
- `bindModel(keyId, modelId): Promise<void>`
- `unbindBinding(bindingId): Promise<void>`
- `POST /v1/mcp` with `tools/call: list_models`
- `setKeyEnabled(userId, keyId, enabled): Promise<void>`
- `requireOwnedKey(db, userId, keyId, subOnly?): Promise<ApiKey>`

## 3. Contracts

- Every key lookup combines `api_keys.id = keyId` with `api_keys.user_id = session.user.id`.
- `disableKey` verifies ownership before calling the low-level `setKeyEnabled` helper, and the helper repeats `api_keys.user_id = userId` in the update itself.
- `getBindings` verifies key ownership before returning binding rows.
- `bindModel` accepts only a caller-owned `kind='sub'` key.
- A bindable model is enabled and owned by the caller. Public visibility affects WebChat, not gateway key authorization. This must match `getBindableModels`.
- `unbindBinding` resolves the binding's `keyId`, verifies ownership of that key, and only then deletes the binding.
- Model-list endpoints are authorization surfaces: MCP `list_models` returns all enabled owner models for a master key, but joins `key_model_bindings` for a sub key and returns only rows bound to `ctx.apiKeyId`.
- Authorization failures occur before insert, update, or delete. UUID foreign keys and UI filtering are not authorization controls.

## 4. Validation & Error Matrix

| Operation | Required authorization | Invalid result |
| --- | --- | --- |
| Disable key | `key.userId === session.user.id` | Throw before update |
| Persist key status | Key ID + user ID in one update condition | Update zero foreign rows |
| Read bindings | `key.userId === session.user.id` | Throw before returning rows |
| Bind model | Owned sub key + enabled owner model | Throw before insert |
| Unbind model | Binding references an owned key | Throw before delete |
| MCP model list | Owner + enabled; sub key also bound | Omit unbound models |

## 5. Good / Base / Bad Cases

- Good: the caller's enabled public or private model can be bound to their sub key.
- Base: owners can read bindings and disable their own master or sub key.
- Base: a master key's MCP model list contains all enabled owner models; an unbound sub key returns `无可用模型`.
- Bad: `requireSession()` followed by a global key or binding ID write lets any user mutate another user's gateway authorization.
- Bad: treating public visibility as gateway authorization lets a user bind another owner's model even though `/v1/*` is owner-only.

## 6. Tests Required

- Reject disabling and reading bindings for a foreign key.
- Reject binding to a foreign key or a master key without calling insert.
- Reject another user's public or private model without calling insert.
- Accept the caller's enabled public and private models.
- Reject deleting a binding whose key belongs to another user without calling delete.
- Keep positive owner tests for key disable and binding reads.
- Low-level key tests assert `setKeyEnabled` combines key ID and user ID in the update predicate.
- MCP route tests cover master-key owner filtering, sub-key binding join conditions, and an empty binding set.
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
    eq(s.models.ownerUserId, user.id),
  ))
  .limit(1);
if (!model) throw new Error("模型不存在或无权操作");
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
