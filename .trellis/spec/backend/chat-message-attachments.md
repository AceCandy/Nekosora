# Chat Message Attachments

## 1. Scope / Trigger

Apply this contract when changing WebChat image upload, message persistence, branch history, edit/regenerate behavior, or multimodal assembly. Chat attachments are message-owned image references and remain separate from public conversation sharing.

## 2. Signatures

- `message_file_objects(message_id, file_id, sort_order)` has primary key `(message_id, file_id)`, unique `(message_id, sort_order)`, and reverse index `(file_id, message_id)`. Both foreign keys cascade on physical deletion.
- `ChatMessageAttachment = { fileId: string; filename: string; mime: string }` is the client DTO. Storage paths and signed URLs never cross this boundary.
- `resolveChatImageAttachments(db, schema, { userId, conversationId, fileIds }) -> ResolvedChatImage[]` validates and restores request order.
- `editMessage(conversationId, messagePublicId, newContent, attachmentFileIds, model, modelId?) -> { messages, attachments }` validates attachments and vision before destructive writes.
- `buildMultimodalUserMessage(text, files: ResolvedChatImage[])` consumes only rows validated upstream.

## 3. Contracts

- New sends validate every requested ID for owner, conversation, image MIME, and model vision capability before inserting the user message.
- The user message and all ordered attachment links are inserted in one `withConversationMessageWrite` transaction. Do not store attachment IDs in `messages.content`.
- Duplicate client IDs keep their first position. A partial valid subset is never accepted.
- Edit and regenerate requests do not trust client-supplied historical IDs. `/api/chat` reloads links from the persisted user message; edit replaces links in the same transaction that rewrites the message tree.
- Edit validates model vision before deleting descendants or updating the message. Pure-text edits skip vision validation.
- `getVisibleBranch` loads all visible user-message attachments in one query ordered by `(message_id, sort_order)` and projects the DTO. File reads remain authenticated through `/api/files/[fileId]`.
- Image-only messages persist `content: ""`. Text and attachments may not both be empty.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown, foreign, cross-conversation, or non-image ID | HTTP/action failure before any message write |
| Any requested ID is invalid | Reject the entire batch; never send the valid subset |
| Model does not support vision | Reject before new-send insert or edit tree rewrite |
| User message or link insert fails | Roll back both writes |
| Historical message has no links | Preserve legacy pure-text behavior |
| Linked file is physically deleted | Cascading link deletion; do not invent a stale URL |
| File metadata exists but object read fails | Keep text visible and show the image load-failure state |

## 5. Good / Base / Bad Cases

- Good: one validated attachment batch drives both the persisted links and multimodal request.
- Base: old pure-text messages load without attachment queries per message and behave unchanged.
- Bad: persist raw `fileIds` first, then let multimodal assembly independently filter them; UI history and model input can diverge.
- Bad: edit the message tree before checking vision; a pre-stream 400 would leave an irreversible partial edit.

## 6. Tests Required

- Migration tests assert SQL, journal/snapshot lineage, both cascade foreign keys, primary key, order uniqueness, and reverse index.
- Attachment service tests cover deduplication, stable order, owner/conversation/MIME validation, partial invalid batches, and batch history projection.
- Route tests assert attachment/vision rejection performs no message transaction and successful sends pass the same resolved rows to link insertion and orchestration.
- Branch tests assert history projection is batched and edit validation occurs before delete/update/link replacement.
- Store/UI tests cover all-or-nothing upload, image-only send, pre-stream rollback, edit removal, text-free rendering, load failure, and reuse of `FilePreviewModal`.

## 7. Wrong vs Correct

```typescript
// Wrong:the message is durable before the attachment batch is authorized.
const user = await insertUserMessage(content);
const files = await resolveChatImageAttachments(fileIds);

// Correct:validate first, then commit message and links together.
const files = await resolveChatImageAttachments(db, schema, input);
await assertVisionModel(db, schema, modelInput);
await withConversationMessageWrite(db, schema, conversationId, userId, async (tx) => {
  const user = await insertUserMessage(tx, content);
  await insertMessageAttachments(tx, schema, user.id, files);
});
```
