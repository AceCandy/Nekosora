# 修复 Chat 流式回复底部跟随

## Goal

恢复 Chat 中 AI 流式回复的可靠底部跟随，同时保留用户主动查看历史消息与切换会话时的滚动位置记忆。

## Background

- `src/features/chat/components/ChatMessageList.tsx:203-210` 当前用渲染后的 `scrollHeight` 和 24px 阈值手动判断是否继续跟随；单次内容增高超过阈值时会把内容增长误判成用户上滑，之后永久停止。
- `src/features/chat/components/ChatMessageList.tsx:232` 在提交 `ce58a9b` 中把 `MessageScroller.Provider autoScroll` 改成 `autoScroll={false}`，与项目既有滚动契约及 `ScrollAnchor` 对原语 following 模式的依赖冲突。
- `src/features/chat/store/chatStreamStore.ts:127-165` 每帧都会不可变更新 `messages`，因此问题不是 React 依赖未触发。
- `@shadcn/react/message-scroller` 0.2.1 已提供 following、anchored、free-scrolling 状态转换；依赖版本未发生回归。

## Requirements

- R1：正常发送、重新生成和编辑重发时，AI 回复超过可视区后持续贴着最新内容，不因单帧高度变化或异步 Markdown 布局停止。
- R2：用户主动上滑后自动跟随立即停止，新内容不得抢回滚动位置。
- R3：用户滚回底部或点击“回到最新”后恢复持续跟随。
- R4：切换离开再返回会话时，若此前停在历史中段，恢复原 `scrollTop`；若此前在底部，打开时定位当前最新内容并保持 following。
- R5：保留 user 消息中上部锚定、短回复下方留白及 `ScrollAnchor` 对重新生成/编辑重发的现有行为。
- R6：滚动跟随继续由 `@shadcn/react/message-scroller` 原语承担；业务层不得重新实现逐帧 `scrollTop=scrollHeight` 控制器。
- R7：不新增 UI、配置、文案或依赖，不改变消息渲染与流式 store 契约。

## Acceptance Criteria

- [ ] AC1：从底部发送长回复，内容超过一屏后仍持续跟随到流式结束。
- [ ] AC2：流式期间主动上滑后位置保持稳定；回复继续增长时不会自动拉回底部。
- [ ] AC3：滚回底部或点击“回到最新”后，后续增量继续跟随。
- [ ] AC4：切到另一会话再返回时，历史中段位置恢复；此前位于底部的会话回到当前最新内容。
- [ ] AC5：正常发送、重新生成和编辑重发仍先锚定对应 user 消息，长到可视边界后再转为底部 following。
- [ ] AC6：删除现有手动流式跟随 effect，Provider 不再被全局固定为 `autoScroll={false}`。
- [ ] AC7：滚动恢复策略有定向单测，相关 lint、typecheck 与测试通过。

## Out Of Scope

- 调整聊天布局、按钮样式、动画、文案或滚动阈值的视觉手感。
- 引入虚拟列表、替换 `@shadcn/react/message-scroller` 或升级其版本。
- 为项目新增完整组件测试、Playwright 或浏览器测试基础设施。
- 持久化滚动位置到数据库或浏览器存储；仍维持当前页面生命周期内的模块级记忆。

## Technical Notes

- 项目规范 `.trellis/spec/frontend/component-guidelines.md` 明确要求 `<Provider autoScroll>` 承担流式 following，业务层不手写滚动控制器。
- 只有“保存位置且不在底部”的会话需要把原语切到 free-scrolling 后恢复旧位置；保存于底部的旧 `scrollTop` 不应恢复，因为内容高度可能已经变化。
- 当前测试环境只覆盖 `src/**/*.test.ts` 的 Node 单测；本任务用纯滚动恢复策略单测守住 autoScroll 决策，真实 DOM 行为保留为浏览器验收项。
