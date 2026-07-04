# Design: Chat 消息分支操作增强

## 决策（已确认）
- continue：**后端续写**（复用 publicId，追加 delta 到同一消息行）
- 范围：软删 + continue **全做**

## 软删除
- 字段：`messages.deletedAt`（nullable timestamp）。pg 用 `timestamp("deleted_at")`，sqlite 用 `integer("deleted_at", { mode: "timestamp" })`。两份 schema 结构一致。
- 迁移：`pnpm db:generate:pg` + sqlite 对应命令生成 `0001_*.sql`，提交 SQL + `meta/0001_snapshot.json` + 更新 `_journal.json`。
- `editMessage` **保持现有硬删子树**（edit 是改写主线，语义上不需撤销）。
- 过滤策略：所有「可见消息」查询补 `isNull(deletedAt)`。受影响查询：
  - `branch.ts`：getMessageSiblings / retryFromMessage / editMessage / getVisibleBranch
  - `conversations.ts`：getMessages / getArtifactsByConversation
  - `orchestrator.ts`：prepareChatContext 压缩查询
  - `route.ts`：parentPublicId/sourcePublicId 解析查询保持不变（解析已删消息无害，避免引入分支歧义）
- 新 action：`softDeleteMessage(publicId)` 设 `deletedAt = now`，校验属主。
- 版本树一致性：过滤后 `getMessageSiblings` / `getVisibleBranch` 自然排除软删行，`versionMap` 计数随之正确。

## 继续生成（Continue）
- 新 action `continueMessage(conversationId, assistantPublicId)`：
  - 沿 parentId 回溯到根构建历史路径（复用 retryFromMessage 的回溯逻辑）
  - 末尾追加该 assistant 消息本身作为 **prefill**（`{role:"assistant", content: 已有文本}`）
  - 返回 `{ assistantPublicId, parentPublicId, messages }`
- 路由 body 加 `continueFromPublicId?: string`，命中时：
  - 复用该 publicId（不 `crypto.randomUUID`）
  - 不插 user 消息（沿用原 user 父消息）
  - 流式 `assistantText` 从 `""` 开始（只发新增 delta，前端追加）
  - `finally`：`update` 该 assistant 行 `content = 原内容 + assistantText`，`status` 重置（不再 insert 新行）
- provider 前缀：messages 末尾 assistant 即 prefill，Anthropic 原生支持，OpenAI 兼容接口亦接受 assistant 结尾续写。
- 并发保护：update 时 `where status != "streaming"` 作为乐观锁，防止并发续写同一行。

## Store（chatStreamStore）
- `deleteMessage(publicId)`：乐观本地移除 + 调 `softDeleteMessage` server action；失败回滚（重新 hydrate）。
- `continueGeneration(publicId)`：调 `continueMessage` 拿 messages + 复用 publicId，POST `/api/chat` 带 `continueFromPublicId`；delta 追加到既有 assistant 消息 content。

## UI
- `ChatMessageItem`：user / assistant hover 出删除按钮（ConfirmDialog 二次确认）；assistant 底部加「继续生成」按钮（与重新生成并列）。
- `ChatMessageList` / `ChatComposer`：下传 `onDelete` / `onContinue`。

## 风险与回滚
- 迁移可回滚（drop column）。
- 软删过滤遗漏 → 删了的消息仍可见：重点验证 getVisibleBranch / getMessages。
- continue 并发：乐观锁兜底。
- 每步独立可验证。
