# Implement: Chat 模型参数调节

## 有序步骤
1. `conversations.ts`：新增 `setConversationModelParams(convId, {temperature?, topP?, maxTokens?})`（null=清除，合并到 composerState）；`getConversationComposerState` 返回三参数。
2. `route.ts`：prepareChatContext 后读 `conv.composerState` 的三参数，若有则覆盖 `irRequest.temperature/top_p/max_tokens`。
3. `ChatToolbar.tsx`：加参数 picker（SlidersHorizontal 触发 + popover：temperature/topP/maxTokens 数值输入 + 重置）。
4. `ChatComposer.tsx`：params state（temperature/topP/maxTokens）+ initialModelParams 回填 + 变化时调 setConversationModelParams；传给 ChatToolbar。
5. `page.tsx`：从 getConversationComposerState 结果取参数传 `initialModelParams`。
6. i18n：modelParams / temperature / topP / maxTokens / resetDefaults 等 key（zh+en）。

## 验证
- `pnpm check` 必过
- 手动：调 temperature 后发送，后端 irRequest 带参数（看 trace 或日志）；切会话参数保留；重置清空

## 回滚点
- composerState jsonb 加字段无迁移，纯代码可回滚
