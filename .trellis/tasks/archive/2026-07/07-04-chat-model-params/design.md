# Design: Chat 模型参数调节

## 决策
- 参数会话级持久化到 `conversations.composerState`（jsonb），新增可选字段 `temperature` / `topP` / `maxTokens`。
- 后端从 conv.composerState 读参数注入 IRRequest（streamText 已支持 temperature/maxOutputTokens/topP）。
- 不改 setConversationComposerState（避免和 cardIds/kbIds 互扰），新增 `setConversationModelParams` 合并更新。

## 数据流
1. 前端 toolbar 参数 picker → ChatComposer 持有 params state → `setConversationModelParams` 写 conv.composerState
2. SSR：`getConversationComposerState` 返回参数 → page.tsx 传 `initialModelParams` → ChatComposer 回填
3. 发送：route.ts 读 `conv.composerState` 参数 → 覆盖 `irRequest.temperature/top_p/max_tokens`（仅当用户设了值）→ streamText 应用

## 范围与默认
- temperature 0–2（步进 0.1），topP 0–1（步进 0.05），maxTokens 正整数（上限留空，由 provider/model 兜底；后续 ModelOption 补 contextWindow 后可 clamp）
- 参数未设（undefined）→ 不传，用模型默认
- 「重置默认」清空三个字段（setConversationModelParams 传 null）

## 受影响文件
- `conversations.ts`：新增 `setConversationModelParams`；`getConversationComposerState` 返回 temperature/topP/maxTokens；`createConversation` options 可选透传
- `route.ts`：prepareChatContext 后用 conv.composerState 覆盖 irRequest 三参数
- `ChatToolbar.tsx`：新增「参数」picker（SlidersHorizontal 图标 + popover 三数值输入 + 重置按钮）
- `ChatComposer.tsx`：params state + 持久化 + initialModelParams 回填
- `page.tsx`：传 initialModelParams
- i18n：modelParams / temperature / topP / maxTokens / reset 等 key

## 风险与回滚
- composerState 是 jsonb，加字段无需迁移（向前兼容）
- 参数覆盖只在用户显式设置时生效，不影响默认行为
- 数值范围前端校验 + 后端兜底
