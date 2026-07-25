# 执行计划

1. 在 `src/features/chat/actions/share.test.ts` 增加公开读取回归测试。
   - 断言消息查询同时包含会话 ID 与 `isNull(deletedAt)`。
   - 断言返回值只包含查询到的可见消息，并保持快照顺序。
   - 在修改实现前运行 `pnpm vitest run src/features/chat/actions/share.test.ts`，确认新测试失败。
2. 在 `src/features/chat/actions/share.ts` 为 `getShare` 的消息查询补充最小可见性条件。
   - 复用已导入的 `and` 与 `isNull`。
   - 不修改空分享、元数据和访问时间行为。
3. 更新 `.trellis/spec/backend/chat-message-references.md`，把公开分享读取纳入软删除隔离契约和必测项。
4. 验证与复核。
   - 定向测试：`pnpm vitest run src/features/chat/actions/share.test.ts`
   - 静态检查：`pnpm lint`、`pnpm typecheck`
   - 全量测试：`pnpm test`
   - 生产构建：`pnpm build`
   - 独立只读复核范围、查询条件、测试有效性及未处理阻断问题。
5. 提交、归档任务并记录开发日志；不推送远端。

## 风险文件与回滚点

- `src/features/chat/actions/share.ts`：公开读取行为，必须保持消息顺序和分享元数据不变。
- `src/features/chat/actions/share.test.ts`：mock 查询链必须覆盖 `getShare` 的访问时间更新。
- 回滚以本轮单独提交为单位，不包含其他候选修复。
