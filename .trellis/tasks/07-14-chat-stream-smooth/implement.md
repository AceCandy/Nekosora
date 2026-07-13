# Implement — 聊天流式渲染丝滑化与跟随滚动

执行顺序按依赖关系排列：层1（合批）是层2（animated）流畅的前提；层3（滚动）独立。每步带验证。

## Step 0 · 实测 streamdown animated 假设（review gate，决定层2走法）

不写业务代码，先最小验证 design 的三条关键假设。

- 临时在 `Markdown.tsx` 给 streaming 传 `animated={{ animation: "fadeIn", sep: "char", stagger: 8 }}` + `caret="block"`，构造一次性大 delta（本地 mock 一个整段返回的流，或直接挑一个会话让 content 一次性灌入）。
- 观察确认：
  1. 仅对增量淡入、非全量重做（高频无闪烁）；
  2. 大段同步到达时是"逐字流出"而非瞬现；
  3. 流式结束光标消失、回到 static。
- 验证手段：浏览器手动跑 `pnpm dev` + Performance 面板看帧率。
- **分支**：
  - 假设成立 → 层2 按计划启用 streamdown animated，跳过自写 pacing。
  - 假设不成立 → 层2 改 fallback：写 `useStreamPacing` hook（见 design），Markdown 渲染 `displayed`。
- 验证完成后**回退临时改动**，进入 Step 1。

## Step 1 · 层1 store delta 合批

- [ ] 在 `chatStreamStore.ts` 模块级加 `deltaBuffer` / `enqueueDelta` / `flushDeltas` / `flushDeltasNow`（见 design 层1）。
- [ ] `send` 内 `appendToMessageAt`/`appendReasoningAt` 改调 `enqueueDelta`；`finally` 置 `streaming:false` 前调 `flushDeltasNow()`。
- [ ] `regenerate` / `editAndResend` / `continueGeneration` 的 `onDelta`/`onReasoning` 内联 set 改调 `enqueueDelta`；各自 `finally` 调 `flushDeltasNow()`。
- [ ] 注意：`onError`(setMessageContentAt)、`onTrace`、`onSearchResult`、`onToolCall`/`onToolResult`、`onUserMessage`/`onAssistantMessage`/`onTitleUpdated` 等非高频路径**保持原样**（不合批），只合批 delta/reasoning。
- 验证：
  - `pnpm typecheck`
  - 临时在 `flushDeltas` 打点计数，确认流式期间每帧 set ≤1 次（DevTools）。
  - 手动发消息，流式正常显示、末尾不丢字。

## Step 2 · 层2 启用 streamdown animated + caret（依据 Step 0 结论）

- [ ] `Markdown.tsx`：`isStreaming` 时传 `animated` + `caret="block"`；非流式 `animated={false}`、无 caret。
- [ ] 实测调 `sep`/`stagger`/`duration`，到逐字跟手 + 大块不瞬现且能追上。
- [ ] 若 Step 0 判定走 fallback：新建 `features/chat/hooks/useStreamPacing.ts`，`ChatMessageItem` 对 `isStreaming && isLast && role==="assistant"` 的 content 经 pacing 得 `displayed`，`Markdown content={displayed}`；流结束 snap 全量。
- 验证：
  - 流式有逐字淡入 + 末尾闪烁光标；结束光标消失。
  - custom 渲染器（输出样式）静态重渲不受影响。
  - `pnpm typecheck`。

## Step 3 · 层3 pinned 滚动跟随重构

- [ ] `useChatScrollController.ts`：加 `pinnedRef`（默认 true）。
- [ ] 新增事件监听 effect：`wheel`(deltaY<0 且非底部)/`touchstart`+`touchmove`+`touchend`/`keydown`(ArrowUp/PageUp/Home 且非底部) → `pinnedRef=false`；卸载移除。
- [ ] `onScroll`：`measureBottom()` 为真 → `pinnedRef=true`（回到底部自动恢复跟随）；`isNearBottom` 同步逻辑保留。
- [ ] 跟随 effect：`if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;` 替换原 `endRef.scrollIntoView`。
- [ ] `forceFollow`/`scrollToBottom`：置 `pinnedRef=true` + 保留 `smoothScrollToBottom`。
- [ ] 保留 hide-until-settled 初始收敛逻辑与 `isNearBottom`。
- 验证：
  - 长回复（>1 屏）持续自动贴底，中途不丢跟随（AC3）。
  - 生成中上滑 → 立即停跟随、按钮出现；继续生成不抢滚动（AC4）。
  - 滚回底部或点「回到最新」→ 恢复跟随（AC5）。
  - 历史长会话打开即贴底 + 淡入（hide-until-settled 未回归）。

## Step 4 · 全量验证与单测

- [ ] 回归：中断→续写、重生成、编辑重发、版本切换、切会话再切回流式不断、新会话建会 migrate（AC7）。
- [ ] `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿。
- [ ] 补单测：
  - 合批：`enqueueDelta` 多次调用 → 单帧单次 set、`flushDeltasNow` 兜底（纯函数化 `flushDeltas` 的 set 可注入 mock）。
  - pinned：用户上滑事件 → pinnedRef false；回到底部 → true（hook 逻辑抽纯函数便于测）。
- [ ] 跨浏览器/暗色模式快看一眼光标与淡入样式（DESIGN：无裸 hex、静止无投影）。

## Review Gates / 回滚点

- Step 0 是硬关卡：结论决定层2 两条路径之一。
- 每层独立可回滚（见 design「回滚形状」）；任一层出问题不影响另两层已验证成果。
