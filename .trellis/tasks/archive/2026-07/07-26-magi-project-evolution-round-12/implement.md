# Implementation Plan

1. 为会话消息写锁补单元测试，验证事务、`FOR UPDATE`、属主条件和 callback 使用同一 transaction。
2. 为 route 收尾失效补 SSE 回归，验证引用竞争导致 error、run failed 且不发送 `[DONE]`。
3. 为 branch edit/soft delete 补回归，验证它们在共同锁内重新读取目标/子树并使用条件写。
4. 实现 `withConversationMessageWrite`，将新 user 插入和 assistant 最终持久化迁入短事务锁。
5. 为 assistant insert 重新验证 user/source，为 continue 增加内容版本条件更新和 `returning` 命中检查。
6. 将 edit/soft delete 的重新解析、子树读取与写入迁入同一会话锁事务；edit 条件更新失败时抛错回滚。
7. 运行聚焦测试并独立复核所有六个消息写点、锁持有范围、错误/DONE/run 收敛和正常流程兼容性。
8. 更新聊天消息引用规范，执行 lint、typecheck、全量 Vitest、生产构建和 diff 检查。
9. 提交实现、归档任务、记录 journal，然后自动进入下一轮。

## Risk And Rollback Points

- `src/lib/chat/message-reference.ts`：锁查询和 callback 必须在同一个 Drizzle transaction/连接内。
- `src/app/api/chat/route.ts`：不得把事务扩展到 `prepareChatContext` 或 provider stream；持久化失败不得执行 artifact、memory enqueue 或 `[DONE]`。
- `src/features/chat/actions/branch.ts`：edit 的后代删除与原消息条件更新必须同事务，避免更新未命中后留下已删除子树。
- `softDeleteMessage` 的首个 owner-scoped 查询仍用于避免存在性泄露；获得 conversationId 后必须在锁内重新解析目标。
- 现有 route 请求字段和 SSE 事件类型保持不变。

## Validation Commands

- `pnpm exec vitest run src/lib/chat/message-reference.test.ts src/features/chat/actions/branch.test.ts src/app/api/chat/route.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## Completion Gate

- 六个消息写点都处于同一个按 conversation 串行的短事务协议内。
- 任何最终引用或内容版本失效都不能产生数据库成功或 SSE `[DONE]` 假成功。
- 正常 send/retry/edit/continue 行为与公开协议不变。
- 独立复核无阻塞项，全部自动化门禁通过。
