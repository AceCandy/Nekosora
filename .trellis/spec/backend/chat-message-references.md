# Chat Message Reference Isolation

## 1. Scope / Trigger

Apply this contract when `/api/chat`, branch actions, or message-tree traversal resolves a client-supplied message public ID or internal ID. It also applies when a chat server action mutates a resource, such as revoking a conversation share. Owning one conversation does not authorize references to messages or shares associated with another user's conversation.

## 2. Signatures

- `findConversationMessage(db, schema, conversationId, { publicId })`
- `findConversationMessage(db, schema, conversationId, { id })`
- `createShare(conversationId): Promise<string>`
- `getShare(shareId): Promise<{ title; model; messages } | null>`
- `revokeShare(shareId): Promise<void>`
- Exactly one identifier is supplied; the result is a message row or `null`.

## 3. Contracts

- The lookup SQL always combines the identifier with `messages.conversation_id = currentConversationId`.
- Parent, source, reused user, continuation target, continuation parent, and artifact message lookups use the scoped helper.
- Branch actions resolve retry, edit, continue, and parent message references through the scoped helper after authorizing the conversation.
- Sibling queries with a non-null `parentId` also constrain `messages.conversation_id`; malformed cross-conversation tree edges must not widen reads.
- Reused user references require `role='user'`; continuation targets require `role='assistant'` and a same-conversation user parent.
- New user inserts return their internal ID. Assistant persistence uses that verified ID directly instead of re-querying a bare public ID.
- Missing and cross-conversation references return the same 400-class behavior and do not reveal whether the identifier exists elsewhere.
- Share creation snapshots only message public IDs where both `messages.conversation_id = conversationId` and `messages.deleted_at IS NULL`.
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
| sibling `parentId` query | Original message conversation | Return only same-conversation siblings |
| share message snapshot | Owned conversation + `deletedAt IS NULL` | Exclude deleted message IDs |
| public share message read | Share conversation + `deletedAt IS NULL` | Skip deleted snapshot IDs; keep the share valid |
| share revocation | Share conversation owned by session user | Throw `无权操作` before update |

## 5. Good / Base / Bad Cases

- Good: a leaked public ID from another conversation cannot become a parent or source in the current message tree.
- Good: an authenticated user cannot revoke a share belonging to another user's conversation.
- Good: creating a share after soft deletion publishes only messages still visible in the conversation.
- Good: deleting a message after share creation removes it from the existing public link.
- Base: normal send, retry, edit, continue, sibling lookup, and owner share revocation preserve existing behavior.
- Bad: querying by globally unique public ID alone allows cross-conversation edges that branch traversal can later follow.
- Bad: treating `requireSession()` alone as authorization allows any authenticated user to mutate another user's share by `shareId`.
- Bad: selecting share message IDs by `conversationId` alone republishes soft-deleted content.
- Bad: filtering only at share creation leaves later soft-deleted content readable through existing links.

## 6. Tests Required

- Helper tests cover public and internal identifiers and assert both identifier + conversation SQL conditions.
- Branch action tests assert retry/edit/continue use the scoped helper and that cross-conversation edit targets trigger no update or delete.
- Sibling tests assert the parent query includes the original message's `conversationId`.
- Share creation tests assert the message query combines `conversationId` with `isNull(deletedAt)` and both stored ID lists contain only returned visible messages.
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
// Wrong:soft-deleted messages remain eligible for creating or reading a share.
const messages = await db.select().from(s.messages)
  .where(eq(s.messages.conversationId, conversationId));

// Correct:use the conversation's current visible message set at both boundaries.
const messages = await db.select().from(s.messages)
  .where(and(
    eq(s.messages.conversationId, conversationId),
    isNull(s.messages.deletedAt),
  ));
```
