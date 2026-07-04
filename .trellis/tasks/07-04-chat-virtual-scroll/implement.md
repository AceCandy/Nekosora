# Implement: Chat 消息虚拟滚动

## 步骤
1. `pnpm add @tanstack/react-virtual`
2. `ChatMessageList`：import `useVirtualizer`；组件内 `count=messages.length` 的 virtualizer；消息渲染替换为虚拟项（绝对定位 + measureElement）。
3. `pnpm check`

## 验证（需手动运行 app）
- 长会话滚动流畅
- 流式贴底跟随 / 上滑停止 / 发消息回底 / 「跳到最新」
- 版本切换、大纲跳转（注意：跳到不可见消息受虚拟化限制）

## 回滚
- 纯渲染层改动，revert ChatMessageList 即可恢复原 map 渲染
