# Implement: Chat 消息分支操作增强

## 有序步骤

1. **schema 加 deletedAt**：`src/db/schema/pg.ts` messages 加 `deletedAt: timestamp("deleted_at")`；`sqlite.ts` 加 `deletedAt: integer("deleted_at", { mode: "timestamp" })`。
2. **生成迁移**：`pnpm db:generate:pg`（+ sqlite 对应）；校验生成的 `0001_*.sql` 是 `ALTER TABLE messages ADD COLUMN deleted_at ...`；提交 meta 快照 + journal。
3. **branch.ts**：加 `visibleMsgsFilter` 复用；改 getMessageSiblings / retryFromMessage / editMessage / getVisibleBranch 四处查询补过滤；新增 `softDeleteMessage` 与 `continueMessage` 两个 server action。
4. **conversations.ts**：getMessages / getArtifactsByConversation 补过滤。
5. **orchestrator.ts**：prepareChatContext 内压缩查询补过滤。
6. **route.ts**：body 加 `continueFromPublicId`；命中时分流（复用 publicId、不插 user、finally update 而非 insert、乐观锁）。
7. **store**：chatStreamStore 加 `deleteMessage` + `continueGeneration`。
8. **ChatMessageItem**：删除按钮 + 继续生成按钮。
9. **ChatMessageList / ChatComposer**：下传 onDelete / onContinue。
10. **i18n**：delete / continueGenerating / deleteMessageConfirm 等 key（zh + en）。

## 验证
- `pnpm check`（lint + typecheck）必过
- `pnpm db:generate:*` 生成的迁移幂等、meta 一致
- 手动：删中间消息后续仍在；删分支版本只删当前版本；继续生成追加到原消息末尾；删后版本计数正确

## 回滚点
- schema 迁移可 drop column 回滚
- 每步独立 commit，可单独 revert
