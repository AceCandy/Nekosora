# 保护弹窗未保存表单：实施计划

1. 新增共享未保存关闭守卫和双语共享文案。
   - 验证：单测证明 clean、dirty、恢复基线、继续编辑和放弃修改行为。
2. 接入指令卡、模型、路由、供应商、输出模式和渲染样式表单。
   - 验证：每个 `Modal.onClose` 与取消按钮使用 `requestClose`，保存成功仍使用原关闭函数。
3. 接入密钥备注、密钥批量添加和会话重命名。
   - 验证：嵌套弹窗只保护自身草稿，继续编辑不清空输入，放弃修改复用现有重置逻辑。
4. 补共享 `Modal` 关闭入口契约测试，并运行共享守卫、`ShareDialog` 和相关表单测试。
   - 验证：`pnpm --filter @nekusora/web exec vitest run <relevant files>`。
5. 执行前端质量门禁和独立复核。
   - 验证：`pnpm --filter @nekusora/web lint`、`pnpm --filter @nekusora/web typecheck`、`pnpm --filter @nekusora/web test`。
   - 复核：对照 PRD R1 逐项检查实现、国际化键、测试和工作树 diff，不扩大到 Out of Scope。

## 风险文件与回滚点

- 共享契约：`apps/web/src/shared/ui/UnsavedChangesDialog.tsx`。
- 嵌套弹窗：`apps/web/src/features/providers/KeyBundleEditor.tsx`。
- 复杂混合表单：`apps/web/src/features/providers/ProviderFormDialog.tsx`、`apps/web/src/features/models/ModelFormDialog.tsx`、`apps/web/src/features/models/RouteFormDialog.tsx`。
- 每完成一组接入后均可单独回退该组件；共享 `Modal` 未修改，回滚不影响其他弹窗。
