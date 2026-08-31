# Conversation Sharing

## 1. Scope / Trigger

Apply this contract when changing conversation share creation, public reads, password unlock, expiry, render styles, message-version selection, or the PostgreSQL schema behind those flows. Sharing crosses authenticated owner actions, anonymous public reads, Chat runtime state, and durable database state; a UI-only restriction is never sufficient.

## 2. Signatures

- `createShare(input: CreateShareInput): Promise<ConversationShareListItem>`
- `listConversationShares(conversationId): Promise<ConversationShareListItem[]>`
- `getShare(shareId): Promise<PublicShareState>`
- `unlockShare(shareId, password): Promise<UnlockShareResult>`
- `revokeShare(shareId): Promise<void>`
- `selectMessageVersion(messagePublicId): Promise<void>`
- `PublicShareState = { status: "unavailable" } | { status: "locked" } | { status: "ready"; title; model; messages; renderStyle }`
- `PublicShareMessage` is an explicit allowlist of `role`, `content`, optional `createdAt`, and optional safe `runMetadata`; it never includes `processTrace`, attachments, or RAG sources.
- `conversation_shares.mode`: nullable `snapshot | live`; `null` means legacy.
- `conversations.message_version_selections`: nullable JSON object keyed by assistant sibling `parentId`.

## 3. Contracts

- Creation authenticates the owner, validates `CreateShareInput` with zod, resolves the visible branch on the server, and inserts one immutable configuration row in a transaction. The client never supplies trusted message bodies, status, title, model, or CSS.
- `snapshot` freezes title, model, ordered visible message bodies, and the complete selected render-style definition. An omitted `renderStyleId` inherits the conversation style; explicit `null` freezes default rendering. Later message deletion, edits, version changes, or style mutation do not alter a new snapshot.
- `live` ignores per-link style input. Every ready read resolves the current conversation title, model, visible branch, persisted version selections, and enabled style. A missing or disabled current style degrades to `renderStyle: null`, never a 500 response.
- Legacy rows have `mode IS NULL`, no password, and no expiry. They keep the pre-upgrade behavior: stored snapshots are filtered by current soft-delete tombstones and use default rendering.
- Missing, revoked, and expired rows all return only `{ status: "unavailable" }`. A protected row without a valid share-bound unlock cookie returns only `{ status: "locked" }`. These states never include title, model, messages, CSS, password verifier, or unlock metadata.
- Passwords are 8-128 characters at both creation and unlock runtime boundaries. The database stores only a versioned asynchronous scrypt verifier with random salt. Unlock validates length before database access or KDF work.
- Unlock failure accounting uses PostgreSQL atomic client and share-global buckets. The client fingerprint is a domain-separated HMAC and never stores a raw IP. Production proxies must overwrite `x-forwarded-for`/`x-real-ip`; without a trusted proxy boundary, the client bucket is spoofable and only the share-global bucket remains authoritative.
- A successful unlock sets an HttpOnly, SameSite=Lax, production-Secure cookie scoped to `/share/{shareId}`. Its expiry is `min(now + 24h, share.expiresAt)`. Every content read rechecks status and expiry, so revocation invalidates an existing cookie immediately.
- Manual version switching persists `selectMessageVersion(target.publicId)` before replacing local runtime state. Regeneration records the real assistant public ID from SSE after the stream completes; persistence failure is logged separately and must not turn a successful generation into a generation error.
- Share configuration is immutable. Owners may list safe DTOs, copy URLs, revoke links, and create replacements. Listing never returns verifier, snapshots, CSS, cookies, or rate-limit rows.
- Snapshot, live, and legacy public reads must project messages through the public message allowlist. Private attachment and RAG provenance (`fileId`, `filename`, `mime`, preview URLs, and `processTrace`) remain owner-only even when they are stored on the source message.

## 4. Validation & Error Matrix

| Condition | Result / side effect |
| --- | --- |
| Invalid mode, expiry, password length, or live style override | Reject before insert |
| Foreign or missing conversation on owner action | Throw the same authorization failure; no write |
| Snapshot style missing or disabled at creation | Reject; no share row |
| Live style missing or disabled at read time | Ready response with `renderStyle: null` |
| Missing, revoked, or expired public share | `{ status: "unavailable" }` only |
| Protected share without valid cookie | `{ status: "locked" }` only |
| Unlock password shorter than 8 or longer than 128 | `{ ok: false, reason: "invalid" }` before DB/KDF |
| Failed password below limit | Atomically increment client and global buckets; return `invalid` |
| Blocked password attempt | Return `rate_limited` with retry seconds; do not run scrypt |
| Stale message-version selection | Ignore it and fall back to the latest valid sibling |
| Version persistence fails after successful regeneration | Keep generated message; report persistence failure separately |
| Source message contains attachment or RAG provenance | Strip it during public projection; return no private file fields or preview entry |

## 5. Good / Base / Bad Cases

- Good: a snapshot remains byte-for-byte stable after the owner edits the conversation or an administrator changes/deletes the source style.
- Good: a live link follows later messages and the owner's persisted assistant version after refresh.
- Good: an empty current conversation can still open the management dialog and revoke an older share, while creating a new share stays disabled.
- Good: a live share of an answer backed by private RAG returns the answer body and safe run metadata but no filename, MIME, file ID, trace, or preview URL.
- Base: an unprotected permanent link returns ready content without setting an unlock cookie.
- Base: a legacy row remains readable with its historical soft-delete semantics.
- Bad: using `renderStyleId ?? conversation.renderStyleId` erases explicit `null` and prevents selecting default snapshot rendering.
- Bad: throwing when a live conversation style is disabled turns a recoverable presentation change into a public 500 response.
- Bad: trusting TypeScript's `password: string` signature as runtime validation allows oversized Server Action inputs to reach scrypt.
- Bad: hiding private fields in the component after returning them from `getShare` leaks them across the Server Component boundary.
- Bad: spreading a database message or frozen message JSON into `PublicShareMessage` can expose future private fields by default.

## 6. Tests Required

- Migration tests assert the new nullable columns, share-list index, unlock-attempt table, unique bucket key, FK cascade, journal sequence, and snapshot `prevId`.
- Share action tests cover owner isolation, server-derived visible order, strict snapshot behavior, explicit default style, live style fallback, legacy filtering, safe list DTOs, expiry/revocation equivalence, and locked-state non-disclosure.
- Share projection tests place unique `fileId`, `filename`, and `mime` sentinels inside stored RAG trace data and assert that serialized `getShare` results contain none of them.
- Security tests cover scrypt verifier parsing, malformed verifiers, constant-time comparison boundary, share-bound HMAC cookies, 24-hour/expiry clipping, and invalid password length before DB/KDF.
- Rate-limit tests cover client/global thresholds, window reset, successful client-bucket clear, and transaction failure propagation.
- Branch/store tests cover stale selection fallback, manual switch persistence before local mutation, regeneration using the real SSE public ID, and persistence failure isolation.
- Clipboard tests cover missing/rejected Clipboard API and cleanup of the temporary textarea on both success and exception.
- Browser checks cover desktop/mobile read-only Markdown, frozen CSS, password unlock, unavailable links, and no console errors. Do not stop a user-owned development server.

## 7. Wrong vs Correct

```typescript
// Wrong: explicit null silently inherits the conversation style.
const selectedStyleId = input.renderStyleId ?? conversation.renderStyleId;

// Correct: only omission means "inherit"; null means default rendering.
const selectedStyleId = input.renderStyleId === undefined
  ? conversation.renderStyleId
  : input.renderStyleId;
```

```typescript
// Wrong: one helper makes a disabled live style fatal.
renderStyle = await loadRenderStyleSnapshot(db, schema, conversation.renderStyleId);

// Correct: creation is strict, while live reads degrade to the default renderer.
const frozenStyle = await loadRenderStyleSnapshot(db, schema, selectedStyleId, true);
renderStyle = await loadRenderStyleSnapshot(db, schema, conversation.renderStyleId, false);
```

```typescript
// Wrong: a selection write failure is handled as if generation failed.
await consumeChatSSE(body, handlers);
await selectMessageVersion(realPublicId);

// Correct: generation and post-generation selection persistence have separate failure domains.
await consumeChatSSE(body, handlers);
try {
  await selectMessageVersion(realPublicId);
} catch (error) {
  console.error("persist regenerated version failed:", error);
}
```

```typescript
// Wrong: new stored message fields become public automatically.
return { ...message };

// Correct: project only the public message contract.
return { role: message.role, content: String(message.content ?? "") };
```
