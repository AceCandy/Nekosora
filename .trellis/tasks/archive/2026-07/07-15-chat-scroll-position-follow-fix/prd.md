# 修复聊天新消息中上部定位与流式跟随滚动失效

## Goal

恢复两个被 `4340ece`(流式渲染丝滑化与跟随滚动)破坏的聊天滚动体验,使其对齐 ChatGPT / Claude / Grok 的既有体感:

1. **新消息中上部定位**:发送消息后,用户消息出现在视口中上部、回复在其下方生长(下方留白),而非贴顶或贴底。
2. **流式跟随**:回复超过视口底部后,视图随流式吐出的文字自动向下跟随,无明显滞后/卡顿/溢出。

## Background(根因摘要)

- `4340ece` 把跟随策略从「底部 `h-2/3` 缓冲撑高」改成「纯 `scrollTop = scrollHeight` 贴底」,并移除了底部缓冲。
- 效果一失效:prompt-pin 靠 `scrollBy(负值)` 把用户消息上推到 18% 位置,但内容不足视口时 `scrollTop` 已为 0、不可为负,滚动无效 → 消息停在顶部;原 `h-2/3` 缓冲正是用来撑高让 `scrollTop` 可调的,被删后失去手段。
- 效果二失效:消息列表用 `@tanstack/react-virtual` 虚拟滚动(子项 `position: absolute`),父容器高度 = `getTotalSize()`,依赖 `measureElement` 的 ResizeObserver **异步测量**;流式时 `scrollHeight` 滞后一帧,`scrollTop = scrollHeight` 贴的是上一帧的底。
- 相关代码:`src/features/chat/hooks/useChatScrollController.ts`、`src/features/chat/components/ChatMessageList.tsx`、`src/features/chat/components/ChatComposer.tsx`。

## Requirements

- 内容不足视口时(新消息 / 短会话),消息出现在视口中上部,下方留白给回复生长,**不贴顶、不贴底**。
- 内容超过视口后,流式吐出新文字时视图持续跟随到底部,无明显溢出或卡顿。
- 保留 `4340ece` 引入的 **pinned 语义**:用户主动上滑(wheel/touch/key)停止跟随并尊重其位置;滚回底部阈值内或点「回到最新」恢复跟随。
- 流式结束收尾贴底,消除偏上留白。

## Constraints

- 不回退虚拟滚动(`14c64c2` 引入,长会话性能依赖)。
- `scrollTop` 不可为负(浏览器约束)→ 中上部留白必须用**布局**实现,不能靠滚动上推。
- 最小改动、易回滚;不破坏既有:虚拟滚动、hide-until-settled 进会话贴底淡入、对话大纲、回到最新按钮、会话切换。

## Acceptance Criteria

- [ ] 新会话发首条消息:用户消息出现在视口中上部(非顶部 `pt-8`、非贴底),下方留白可见。
- [ ] 流式回复增长超过视口底部后,视图持续跟随最新文字,无明显溢出/卡顿/滞后。
- [ ] 流式中主动上滑 → 停止跟随;滚回底部 → 恢复跟随;「回到最新」按钮显隐正常。
- [ ] 已有长会话进入:hide-until-settled 贴底淡入正常,无测量追赶滚动。
- [ ] 长会话(>50 条)虚拟滚动正常,无明显性能回退。
- [ ] 流式结束:贴底收敛,无偏上留白残留。
- [ ] 浏览器实测(新会话 + 历史会话 + 长回复 + 用户上滑)四场景通过。

## Notes

- 方案选择(布局驱动 vs 恢复缓冲)与技术细节见 `design.md`。
