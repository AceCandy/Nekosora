# 实施计划：联网搜索工具轮耗尽后的最终总结与逐调用展示

## 顺序清单

1. 给 Agent loop 增加工具轮耗尽后的单次无工具总结分支，保持现有终态、usage 聚合和 telemetry 清理契约。
2. 补 Agent loop 与 completion coordinator 回归测试，覆盖总结成功、失败、取消、唯一 finish 和不重复工具执行。
3. 给无效搜索参数结果增加稳定且可操作的提示，并补互斥参数测试。
4. 扩展 `ToolCallRecord`，让 store 按 `toolCallId` 写入搜索后端与失败原因，同时保留消息级引用聚合。
5. 历史投影按 `toolCallId` 合并 process trace 搜索后端/原因到工具记录。
6. 更新消息组件逐条展示自己的搜索方式或失败原因，删除首条调用展示聚合后端的逻辑。
7. 补 store、历史投影和组件测试，覆盖多次搜索、失败后成功、不同后端和旧事件兼容。
8. 独立复核 diff，运行定向测试、`pnpm check`、完整测试与 `git diff --check`。

## 验证命令

- `pnpm vitest run src/lib/stream-agent-loop.test.ts src/lib/chat/completion-coordinator.test.ts`
- `pnpm vitest run src/features/chat/model/sse.test.ts src/features/chat/store/chatStreamStore.test.ts src/features/chat/actions/branch.test.ts src/features/chat/components/ChatMessageItem.test.tsx`
- `pnpm check`
- `pnpm test`
- `git diff --check`

## 风险与回滚点

- 最终总结必须禁用工具，否则会把有限循环变成新的无限循环入口。
- 总结轮 usage 必须进入现有聚合结果，不能新增第二个外层 finish 或第二条 Agent telemetry。
- 流式和历史投影必须共用 `toolCallId`，不能退回按工具名或数组索引关联。
- 失败调用没有实际后端时宁可不显示后端，也不能借用消息级聚合值。
