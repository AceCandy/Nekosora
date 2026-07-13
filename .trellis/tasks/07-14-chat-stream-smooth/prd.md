# 聊天流式渲染丝滑化与跟随滚动

## Goal

让聊天流式输出在视觉上「丝绸般丝滑」，并修复内容超过一页后不自动跟随、以及用户操作时仍抢滚动的行为。

核心思想：**把「数据到达节奏」与「UI 展现节奏」解耦**——无论上游是逐 token 慢流、一次性大块、还是同步整段返回，前端 UI 都以匀速的流式样式逐字/逐块「流出」，同时滚动跟随尊重用户意图。

## Background（根因）

基于现有代码（`chatStreamStore.ts` / `useChatScrollController.ts` / `ChatMessageList.tsx` / `sse.ts`）定位：

1. **逐 token 全量更新**：`appendToMessageAt` 每个 delta 都 `[...r.messages]` 整组替换 + zustand `set`。中文流常一帧一两个字，相当于每秒几十次 setState，引发 token 级抖动。
2. **滚动 effect 每 token 重跑**：`useChatScrollController` 的 effect 依赖 `[messages]`，每次新数组引用都触发 `endRef.scrollIntoView({behavior:"auto"})` + rAF 重算 measure/setState。
3. **超过一页即停跟随（bug）**：`isAtBottomRef` 完全由 `measureBottom()` 翻转。长内容下虚拟滚动 `measureElement` 异步测量，`scrollIntoView` 滚动时 `scrollHeight` 尚停在意旧估算值 → 滚不到真正底部、差几十像素 → `measureBottom` 返回 false → `isAtBottomRef=false` → effect 不再贴底 → **永久停止跟随**。短内容测量来得及故正常。
4. **无用户/程序滚动区分**：程序自身滚不到位都会被当成「用户离开底部」。

## Requirements

### 功能需求

- **R1 · delta 写入合批**：流式增量不再逐 token 写入 store，按帧（rAF）合批 flush，消除高频 setState 抖动。合批对上游 token 级、大块级、同步整段均生效。
- **R2 · 伪流式逐字展现**：即使上游一次性吐大块或同步返回整段，UI 仍以匀速逐字/逐块「流出」，而非瞬现整段。积压大时自动加速追赶（不越积越多），流结束立即补齐剩余全部（末尾不残留延迟）。
- **R3 · 超一页自动跟随**：生成中内容超过一屏时持续自动滚动跟随到底；跟随过程平滑无跳变。
- **R4 · 用户意图优先（停跟/恢复）**：用户主动上滑（鼠标滚轮 / 触摸 / 键盘上方向键、PageUp、Home）立即停止自动跟随，并显示「回到最新」按钮；用户滚回底部阈值内或点击按钮即恢复跟随。程序触发的滚动不得被误判为「用户离开」。
- **R5 · 流式光标**：生成中在流出文本末尾显示闪烁光标作为视觉锚点；流式结束（含中断）后消失。
- **R6 · 不回归**：中断 / 续写 / 重生成 / 编辑重发 / 版本切换 / 多会话切换 / SSR hydrate / hide-until-settled 初始收敛 等既有行为不变。

### 约束

- 流式**真相状态**（完整 target 内容）仍驻留 `chatStreamStore`（跨路由不断流）；pacing 的「已展现文本」为纯渲染派生，可不进 store（切会话再切回无需重播打字）。
- 遵循前端 spec：hook 归属 `features/chat/hooks/`、交互控制器用 `useRef` 避免闭包陈旧、selector 用 `useShallow` + 模块级常量保稳定引用、样式用 `clsx` + 设计 token（无裸 hex）、静止无投影。
- 流式高频跟随沿用 spec 既定结论：**瞬时贴底**（`scrollTop = scrollHeight`），自定义缓动仅用于用户主动单次「回到底部」。
- 质量门槛：`pnpm lint` + `pnpm typecheck` + `pnpm test` 全绿；触及流式渲染需补/更单测。

## Acceptance Criteria

- [ ] **AC1 帧率稳定**：流式生成期间无明显 token 级卡顿（开发者工具 Performance 帧率稳定，无每 token 的长任务/布局抖动）。
- [ ] **AC2 大块伪流式**：构造一次性返回整段的场景（大 delta 或同步响应），UI 仍逐字/逐块匀速流出，而非整段瞬现；且能在短时间内追上完整内容。
- [ ] **AC3 超一页跟随**：让 AI 输出超过一屏的长回复，内容持续自动滚动贴底直至生成结束，中途不丢失跟随。
- [ ] **AC4 用户上滑即停**：生成中用户上滑，立即停止跟随、「回到最新」按钮出现；此期间内容继续生成但不抢占滚动。
- [ ] **AC5 恢复跟随**：用户滚回底部，或点击「回到最新」，立即恢复自动跟随到底。
- [ ] **AC6 光标**：生成中文本末尾有闪烁光标；生成结束/中断后光标消失。
- [ ] **AC7 不回归**：中断→续写、重生成、编辑重发、版本切换、切会话再切回流式不断、SSR 长会话打开即贴底（hide-until-settled）均正常。
- [ ] **AC8 质量门槛**：`pnpm lint` / `pnpm typecheck` / `pnpm test` 通过；新增 pacing/合批逻辑有对应单测。

## Out of Scope

- 后端流式协议、SSE 帧格式、虚拟滚动替换、Markdown 解析逻辑、输出样式（custom 渲染器）改动均不在本期范围。
- 不引入新的动画/状态库（不加 framer-motion / React Query 等）。
