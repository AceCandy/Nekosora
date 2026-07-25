# Chat Message Reference Isolation

## 1. Scope / Trigger

Apply this contract when `/api/chat`, branch actions, or message-tree traversal resolves a client-supplied message public ID or internal ID. It also applies when a chat server action mutates a resource, such as revoking a conversation share. Owning one conversation does not authorize references to messages or shares associated with another user's conversation.

## 2. Signatures

- `findConversationMessage(db, schema, conversationId, { publicId })`
- `findConversationMessage(db, schema, conversationId, { id })`
- `createShare(conversationId, messagePublicIds): Promise<string>`
- `getShare(shareId): Promise<{ title; model; messages } | null>`
- `revokeShare(shareId): Promise<void>`
- `softDeleteMessage(messagePublicId): Promise<string[]>`
- Exactly one identifier is supplied; the result is a message row or `null`.

## 3. Contracts

- The lookup SQL always combines the identifier with `messages.conversation_id = currentConversationId`.
- Parent, source, reused user, continuation target, continuation parent, and artifact message lookups use the scoped helper.
- Branch actions resolve retry, edit, continue, and parent message references through the scoped helper after authorizing the conversation.
- Sibling queries with a non-null `parentId` also constrain `messages.conversation_id`; malformed cross-conversation tree edges must not widen reads.
- Reused user references require `role='user'`; continuation targets require `role='assistant'` and a same-conversation user parent.
- New user inserts return their internal ID. Assistant persistence uses that verified ID directly instead of re-querying a bare public ID.
- Missing and cross-conversation references return the same 400-class behavior and do not reveal whether the identifier exists elsewhere.
- `softDeleteMessage` resolves the target with one query that joins `messages.conversation_id = conversations.id` and filters `conversations.user_id = session.user.id`; missing and foreign targets therefore use the same query path and throw `消息不存在` before role validation.
- Share creation receives the ordered public IDs currently visible in the client runtime; streaming, empty, or partially persisted views remain disabled and must not create partial snapshots.
- The server authorizes the complete submitted set with `conversationId + deletedAt IS NULL + publicId IN (...)`. Empty, duplicate, missing, deleted, cross-conversation, or cross-user IDs throw `分享消息无效` before insert.
- Database result order is validation-only. Both snapshot ID arrays preserve the client-visible order so a switched assistant version replaces, rather than accompanies, its hidden sibling.
- Public share reads apply the same `conversationId + deletedAt IS NULL` scope before restoring snapshot order; messages soft-deleted after share creation must disappear from existing share links.
- Share revocation resolves the share, loads its associated conversation, and verifies `conversation.userId === session.user.id` before updating the share row.

## 4. Validation & Error Matrix

| Reference | Required scope / role | Invalid result |
| --- | --- | --- |
| parent / source public ID | Current conversation | 400 before generation |
| reused user public ID | Current conversation + user role | 400 before generation |
| continue public ID | Current conversation + assistant role | 400 before generation |
| continuation parent ID | Current conversation + user role | 400 before generation |
| generated assistant artifact lookup | Current conversation | Skip when absent |
| branch retry / edit / continue target | Authorized current conversation | Throw `消息不存在` before mutation |
| soft-delete target | `publicId` + conversation owned by session user, then `role='user'` | Missing/foreign: `消息不存在`; owned non-user: `仅支持删除用户消息`; no update |
| sibling `parentId` query | Original message conversation | Return only same-conversation siblings |
| share message snapshot | Owned conversation + non-empty unique visible IDs, all matching `conversationId + deletedAt IS NULL` | Throw `分享消息无效`; no insert |
| public share message read | Share conversation + `deletedAt IS NULL` | Skip deleted snapshot IDs; keep the share valid |
| share revocation | Share conversation owned by session user | Throw `无权操作` before update |

## 5. Good / Base / Bad Cases

- Good: a leaked public ID from another conversation cannot become a parent or source in the current message tree.
- Good: an authenticated user cannot revoke a share belonging to another user's conversation.
- Good: deleting a foreign message ID and deleting a missing ID execute the same owner-scoped lookup and return the same error.
- Good: creating a share publishes only the ordered message versions visible when the user clicks Share; hidden regenerated siblings stay private.
- Good: deleting a message after share creation removes it from the existing public link.
- Base: normal send, retry, edit, continue, sibling lookup, and owner share revocation preserve existing behavior.
- Bad: querying by globally unique public ID alone allows cross-conversation edges that branch traversal can later follow.
- Bad: treating `requireSession()` alone as authorization allows any authenticated user to mutate another user's share by `shareId`.
- Bad: loading a message globally and checking its conversation in a second query still leaks existence through query count/timing, even if both paths use the same error text.
- Bad: selecting every message by `conversationId` publishes regenerated siblings hidden from the current UI.
- Bad: accepting the subset returned by an owner-scoped query creates a partial or cross-conversation snapshot; the validated set must exactly match the submitted set.
- Bad: filtering only at share creation leaves later soft-deleted content readable through existing links.

## 6. Tests Required

- Helper tests cover public and internal identifiers and assert both identifier + conversation SQL conditions.
- Branch action tests assert retry/edit/continue use the scoped helper and that cross-conversation edit targets trigger no update or delete.
- Soft-delete tests assert the target query joins conversations with the current `userId`, missing/foreign user/foreign non-user IDs all throw `消息不存在` without update, and owner role/subtree behavior remains unchanged.
- Sibling tests assert the parent query includes the original message's `conversationId`.
- Share creation tests assert the message query combines `conversationId`, `isNull(deletedAt)`, and `inArray(publicId, submittedIds)`; database result order may differ, but both stored ID lists retain submitted order.
- Share creation tests reject empty, duplicate, partial/foreign, and foreign-owner inputs before insert. Store tests prove version switching replaces the runtime `publicId` consumed by the share caller.
- Public share read tests assert the message query combines the share conversation ID with `isNull(deletedAt)` and preserves snapshot order for returned visible messages.
- Share action tests cover both foreign-owner rejection without update and successful owner revocation.
- Search `/api/chat` for direct message public-ID lookups; none may remain outside the helper.
- Typecheck must preserve explicit row-field narrowing from `Record<string, unknown>`.
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
