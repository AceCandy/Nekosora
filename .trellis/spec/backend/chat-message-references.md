# Chat Message Reference Isolation

## 1. Scope / Trigger

Apply this contract when `/api/chat`, branch actions, or message-tree traversal resolves a client-supplied message public ID or internal ID. Owning the current conversation does not authorize references to messages in another conversation.

## 2. Signatures

- `findConversationMessage(db, schema, conversationId, { publicId })`
- `findConversationMessage(db, schema, conversationId, { id })`
- Exactly one identifier is supplied; the result is a message row or `null`.

## 3. Contracts

- The lookup SQL always combines the identifier with `messages.conversation_id = currentConversationId`.
- Parent, source, reused user, continuation target, continuation parent, and artifact message lookups use the scoped helper.
- Reused user references require `role='user'`; continuation targets require `role='assistant'` and a same-conversation user parent.
- New user inserts return their internal ID. Assistant persistence uses that verified ID directly instead of re-querying a bare public ID.
- Missing and cross-conversation references return the same 400-class behavior and do not reveal whether the identifier exists elsewhere.

## 4. Validation & Error Matrix

| Reference | Required scope / role | Invalid result |
| --- | --- | --- |
| parent / source public ID | Current conversation | 400 before generation |
| reused user public ID | Current conversation + user role | 400 before generation |
| continue public ID | Current conversation + assistant role | 400 before generation |
| continuation parent ID | Current conversation + user role | 400 before generation |
| generated assistant artifact lookup | Current conversation | Skip when absent |

## 5. Good / Base / Bad Cases

- Good: a leaked public ID from another conversation cannot become a parent or source in the current message tree.
- Base: normal send, retry, edit, and continue flows resolve their existing same-conversation messages.
- Bad: querying by globally unique public ID alone allows cross-conversation edges that branch traversal can later follow.

## 6. Tests Required

- Helper tests cover public and internal identifiers and assert both identifier + conversation SQL conditions.
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
