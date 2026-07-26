# Chat Message Reference Isolation

## 1. Scope / Trigger

Apply this contract when `/api/chat`, branch actions, or message-tree traversal resolves a client-supplied message public ID or internal ID. It also applies when a chat server action mutates a resource, such as a message tree or conversation share. Owning one conversation does not authorize references to messages or shares associated with another user's conversation, and a lookup that was valid before an awaited operation does not authorize a later write after the referenced message changed.

## 2. Signatures

- `findConversationMessage(db, schema, conversationId, { publicId })`
- `findConversationMessage(db, schema, conversationId, { id })`
- `withConversationMessageWrite(db, schema, conversationId, userId, operation): Promise<T | null>`
- `createShare(conversationId, messagePublicIds): Promise<string>`
- `getShare(shareId): Promise<{ title; model; messages } | null>`
- `revokeShare(shareId): Promise<void>`
- `conversation_shares.message_snapshots_json`: nullable JSONB array of `{ publicId, role, content }`
- `softDeleteMessage(messagePublicId): Promise<string[]>`
- Exactly one identifier is supplied; the result is a message row or `null`.

## 3. Contracts

- The lookup SQL always combines the identifier with `messages.conversation_id = currentConversationId` and `messages.deleted_at IS NULL`; missing, foreign, and soft-deleted references share the same `null` result.
- Parent, source, reused user, continuation target, continuation parent, and artifact message lookups use the scoped helper.
- Branch actions resolve retry, edit, continue, and parent message references through the scoped helper after authorizing the conversation.
- Sibling queries with a non-null `parentId` also constrain `messages.conversation_id`; malformed cross-conversation tree edges must not widen reads.
- `getMessageSiblings` applies `deletedAt IS NULL` to its initial public-ID lookup before loading the conversation or sibling metadata, so a tombstone cannot remain the current version.
- Reused user references require `role='user'`; continuation targets require `role='assistant'` and a same-conversation user parent.
- New user inserts return their internal ID. Assistant persistence uses that verified ID directly instead of re-querying a bare public ID.
- Missing and cross-conversation references return the same 400-class behavior and do not reveal whether the identifier exists elsewhere.
- Every `messages` insert, update, or delete in `/api/chat` and branch actions runs inside `withConversationMessageWrite`. The helper starts a short transaction, locks the owned conversation row with `FOR UPDATE`, and passes that same transaction object to the operation. The callback must never fall back to the outer `db`.
- Never hold the conversation lock across context preparation, provider calls, or streaming. After a long generation, reacquire the lock and revalidate every parent/source reference in the final write transaction.
- New user insertion revalidates optional parent/source rows after acquiring the lock. Assistant insertion revalidates its active user parent, requires `role='user'`, and compares the stored content with the user content used for generation. A supplied retry source must still be active.
- Continuation uses compare-and-set semantics: the final update combines assistant id, conversationId, `role='assistant'`, `deletedAt IS NULL`, and the original content prefix, then requires one returned row. Concurrent continuations from the same prefix cannot both succeed.
- Edit acquires the conversation lock before resolving the target and reading the active tree. Descendant deletion and the conditional user update share one transaction; a zero-row user update throws so the descendant deletion rolls back.
- Soft delete keeps its initial owner-scoped lookup for existence isolation, then locks the conversation, resolves the target again, reads the latest active tree, and conditionally updates the complete subtree. The returned row count must equal the target set size.
- A final chat persistence conflict sets `persistenceFailed`, emits an error frame, suppresses `[DONE]`, clears `generating` best-effort, and finalizes the run as failed.
- `softDeleteMessage` resolves the target with one query that joins `messages.conversation_id = conversations.id` and filters `conversations.user_id = session.user.id`; missing and foreign targets therefore use the same query path and throw `消息不存在` before role validation.
- Share creation receives the ordered public IDs currently visible in the client runtime; streaming, empty, or partially persisted views remain disabled and must not create partial snapshots.
- The server authorizes the complete submitted set with `conversationId + deletedAt IS NULL + publicId IN (...)`. Empty, duplicate, missing, deleted, cross-conversation, or cross-user IDs throw `分享消息无效` before insert.
- Database result order is validation-only. Both snapshot ID arrays preserve the client-visible order so a switched assistant version replaces, rather than accompanies, its hidden sibling.
- New shares persist ordered message bodies from the validated database rows in `message_snapshots_json`; later user edits and assistant continuations must not change the shared body.
- `message_snapshots_json IS NULL` identifies historical shares and keeps their existing dynamic body lookup. Do not backfill current message bodies as if they were creation-time snapshots.
- Public share reads query the stored public IDs inside the share conversation without discarding `deletedAt`. For new body snapshots, an existing row with non-null `deletedAt` hides the snapshot, while a physically missing row remains frozen because branch editing deletes descendants. Historical null snapshots still require an existing row with null `deletedAt`.
- Share revocation resolves the share, loads its associated conversation, and verifies `conversation.userId === session.user.id` before updating the share row.

## 4. Validation & Error Matrix

| Reference | Required scope / role | Invalid result |
| --- | --- | --- |
| parent / source public ID | Current conversation + `deletedAt IS NULL` | 400 before generation |
| reused user public ID | Current conversation + user role + `deletedAt IS NULL` | 400 before generation |
| continue public ID | Current conversation + assistant role + `deletedAt IS NULL` | 400 before generation |
| continuation parent ID | Current conversation + user role + `deletedAt IS NULL` | 400 before generation |
| parent/source changes before new user insert | Lock-time lookup no longer active | 400; no user insert |
| user parent deleted or edited during generation | Lock-time active user/content check fails | Error SSE; no assistant; no `[DONE]` |
| continuation target deleted or content changed | Conditional update returns zero rows | Error SSE; no `[DONE]`; failed run |
| edit target invalid after lock | Scoped lookup or conditional update fails | Throw; descendant changes roll back |
| soft-delete subtree changes before lock | Lock-time tree includes latest committed children | Update the complete latest subtree |
| soft-delete conditional update is partial | Returned rows differ from target count | Throw; transaction rolls back |
| generated assistant artifact lookup | Current conversation | Skip when absent |
| branch retry / edit / continue target | Authorized current conversation | Throw `消息不存在` before mutation |
| soft-delete target | `publicId` + conversation owned by session user, then `role='user'` | Missing/foreign: `消息不存在`; owned non-user: `仅支持删除用户消息`; no update |
| sibling `parentId` query | Original message conversation | Return only same-conversation siblings |
| share message snapshot | Owned conversation + non-empty unique visible IDs, all matching `conversationId + deletedAt IS NULL` | Throw `分享消息无效`; no insert |
| public share message read | Share conversation + stored public IDs; distinguish existing active, existing soft-deleted, and physically missing rows | New snapshot: hide only explicit soft-delete tombstones; historical null snapshot: return only existing active rows |
| share revocation | Share conversation owned by session user | Throw `无权操作` before update |

## 5. Good / Base / Bad Cases

- Good: a leaked public ID from another conversation cannot become a parent or source in the current message tree.
- Good: a soft-deleted message cannot be reused as a parent, source, edit, retry, continue, or version-switch target.
- Good: edit/delete and chat finalization serialize only their short database sections; whichever acquires the conversation lock second sees the first writer's committed state.
- Good: two continuations generated from the same assistant prefix yield at most one persisted update; the losing response ends with an error and no `[DONE]`.
- Good: an authenticated user cannot revoke a share belonging to another user's conversation.
- Good: deleting a foreign message ID and deleting a missing ID execute the same owner-scoped lookup and return the same error.
- Good: creating a share publishes only the ordered message versions visible when the user clicks Share; hidden regenerated siblings stay private.
- Good: editing or continuing a message after creating a new share does not rewrite that share's body.
- Good: editing a shared user message may physically delete its assistant descendants, but the new share keeps those frozen descendant bodies.
- Base: a historical share with `message_snapshots_json IS NULL` remains readable through its stored message IDs and current bodies.
- Good: deleting a message after share creation removes it from the existing public link.
- Base: normal send, retry, edit, continue, sibling lookup, and owner share revocation preserve existing behavior.
- Bad: querying by globally unique public ID alone allows cross-conversation edges that branch traversal can later follow.
- Bad: re-querying immediately before a write without a shared lock or atomic condition leaves another TOCTOU window between that query and the write.
- Bad: holding `FOR UPDATE` across the provider stream blocks edits/deletes and consumes a database connection for unbounded external latency.
- Bad: checking only the assistant id on continuation permits soft-deleted rows to be rewritten and concurrent continuations to overwrite each other.
- Bad: treating `requireSession()` alone as authorization allows any authenticated user to mutate another user's share by `shareId`.
- Bad: loading a message globally and checking its conversation in a second query still leaks existence through query count/timing, even if both paths use the same error text.
- Bad: selecting every message by `conversationId` publishes regenerated siblings hidden from the current UI.
- Bad: accepting the subset returned by an owner-scoped query creates a partial or cross-conversation snapshot; the validated set must exactly match the submitted set.
- Bad: filtering only at share creation leaves later soft-deleted content readable through existing links.
- Bad: querying only `deletedAt IS NULL` makes explicit soft deletes and branch-edit hard deletes both look absent, so frozen descendant bodies disappear.
- Bad: backfilling historical shares with current bodies falsely labels upgrade-time content as a creation-time snapshot.

## 6. Tests Required

- Helper tests cover public and internal identifiers and assert identifier + conversation + `isNull(deletedAt)` SQL conditions as one `and(...)` predicate.
- Branch action tests assert retry/edit/continue use the scoped helper and that cross-conversation edit targets trigger no update or delete.
- Soft-delete tests assert the target query joins conversations with the current `userId`, missing/foreign user/foreign non-user IDs all throw `消息不存在` without update, and owner role/subtree behavior remains unchanged.
- Sibling tests assert the parent query includes the original message's `conversationId`.
- Sibling tests assert the initial target lookup excludes `deletedAt` tombstones and stops before conversation, tool-call, or feedback queries when absent.
- Share creation tests assert the message query combines `conversationId`, `isNull(deletedAt)`, and `inArray(publicId, submittedIds)`; database result order may differ, but both stored ID lists retain submitted order.
- Share creation tests reject empty, duplicate, partial/foreign, and foreign-owner inputs before insert. Store tests prove version switching replaces the runtime `publicId` consumed by the share caller.
- Public share read tests assert the state query combines the share conversation ID with `inArray(publicId, storedIds)` and explicitly selects `deletedAt`.
- Public share read tests use different snapshot and live bodies for both user and assistant messages, assert the snapshot bodies win for new shares, and assert soft-deleted snapshot entries remain hidden.
- Public share read tests omit a snapshotted assistant row to model branch-edit hard deletion and assert its frozen body remains in order.
- Compatibility tests set `message_snapshots_json` to null and assert historical shares return only existing, non-deleted live bodies in stored ID order.
- Share action tests cover both foreign-owner rejection without update and successful owner revocation.
- Search `/api/chat` for direct message public-ID lookups; none may remain outside the helper.
- Typecheck must preserve explicit row-field narrowing from `Record<string, unknown>`.
- Lock-helper tests assert `conversationId + userId`, `.for("update")`, callback execution on the transaction object, and no callback when the owned row is absent.
- `/api/chat` tests exercise the exported `POST`: a lost parent before user insert returns 400 without insert/context preparation; a lost user or zero-row continuation update emits an error without `[DONE]` and finalizes a failed run; a valid send completes both short transactions and emits `[DONE]`.
- Branch tests cover lock loss without writes, successful conditional edit, latest-subtree soft delete, and partial-returning rejection.
- Search all `messages` insert/update/delete sites; every write must use the transaction passed by `withConversationMessageWrite`.
- Run lint, full tests, production build, and diff checks.

## 7. Wrong vs Correct

```typescript
// Wrong:the public ID exists, but may belong to any conversation.
const [message] = await db.select().from(s.messages)
  .where(eq(s.messages.publicId, publicId));

// Correct:resolve the reference inside the already-authorized conversation.
const message = await findConversationMessage(
  db,
  s,
  conversationId,
  { publicId },
);
```

```typescript
// Wrong: validation and write can be interleaved by edit/delete, and id-only update hides zero-row conflicts.
const assistant = await findConversationMessage(db, s, conversationId, { publicId });
await generate();
await db.update(s.messages).set({ content }).where(eq(s.messages.id, assistant!.id));

// Correct: keep generation outside the transaction, then lock, revalidate, and compare-and-set.
await generate();
const persisted = await withConversationMessageWrite(
  db,
  s,
  conversationId,
  userId,
  async (tx) => {
    const [updated] = await tx.update(s.messages).set({ content })
      .where(and(
        eq(s.messages.id, assistantId),
        eq(s.messages.conversationId, conversationId),
        eq(s.messages.role, "assistant"),
        isNull(s.messages.deletedAt),
        eq(s.messages.content, originalPrefix),
      ))
      .returning({ id: s.messages.id });
    if (!updated) throw new Error("message changed");
  },
);
if (persisted === null) throw new Error("conversation unavailable");
```

```typescript
// Wrong:any authenticated user can revoke any known share ID.
await requireSession();
await db.update(s.conversationShares)
  .set({ status: "revoked" })
  .where(eq(s.conversationShares.shareId, shareId));

// Correct:authorize through the share's owning conversation before mutation.
const user = await requireSession();
const [share] = await db.select().from(s.conversationShares)
  .where(eq(s.conversationShares.shareId, shareId)).limit(1);
if (!share) throw new Error("分享不存在");
const [conversation] = await db.select().from(s.conversations)
  .where(eq(s.conversations.id, share.conversationId)).limit(1);
if (!conversation || conversation.userId !== user.id) {
  throw new Error("无权操作");
}
```

```typescript
// Wrong:server-side conversation scans publish hidden regenerated siblings.
const messageIds = (await db.select({ publicId: s.messages.publicId })
  .from(s.messages)
  .where(eq(s.messages.conversationId, conversationId)))
  .map((message) => message.publicId);

// Correct:the client supplies visible order; the server validates the complete set.
const visibleMessages = await db.select({ publicId: s.messages.publicId })
  .from(s.messages)
  .where(and(
    eq(s.messages.conversationId, conversationId),
    isNull(s.messages.deletedAt),
    inArray(s.messages.publicId, messagePublicIds),
  ));
if (visibleMessages.length !== messagePublicIds.length) {
  throw new Error("分享消息无效");
}
const messageIds = messagePublicIds;
```

```typescript
// Wrong:new shares keep following edits because only message IDs are stored.
await db.insert(s.conversationShares).values({ messageIdsJson: messageIds });

// Correct:freeze validated rows in client-visible order; reads still filter by live undeleted IDs.
const snapshotsById = new Map(visibleMessages.map((message) => [message.publicId, message]));
const messageSnapshotsJson = messageIds.map((id) => snapshotsById.get(id));
await db.insert(s.conversationShares).values({ messageIdsJson: messageIds, messageSnapshotsJson });
```

```typescript
// Wrong:both soft-deleted and physically missing rows disappear from this result.
const current = await db.select().from(s.messages)
  .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)));

// Correct:retain deletion state; only an explicit tombstone retracts a new frozen snapshot.
const current = await db.select({ publicId: s.messages.publicId, deletedAt: s.messages.deletedAt })
  .from(s.messages)
  .where(and(eq(s.messages.conversationId, conversationId), inArray(s.messages.publicId, messageIds)));
const visibleSnapshots = snapshots.filter((snapshot) => !byPublicId.get(snapshot.publicId)?.deletedAt);
```

```typescript
// Wrong:same error text does not hide the different one-query/two-query paths.
const [message] = await db.select().from(s.messages)
  .where(eq(s.messages.publicId, messagePublicId));
if (!message) throw new Error("消息不存在");
const [conversation] = await db.select().from(s.conversations)
  .where(eq(s.conversations.id, message.conversationId));
if (conversation?.userId !== user.id) throw new Error("消息不存在");

// Correct:one owner-scoped query makes missing and foreign targets indistinguishable.
const [message] = await db.select({ id: s.messages.id, role: s.messages.role })
  .from(s.messages)
  .innerJoin(s.conversations, and(
    eq(s.conversations.id, s.messages.conversationId),
    eq(s.conversations.userId, user.id),
  ))
  .where(eq(s.messages.publicId, messagePublicId));
if (!message) throw new Error("消息不存在");
```
