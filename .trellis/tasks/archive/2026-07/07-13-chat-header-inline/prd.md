# ChatHeader下沉到ChatComposer占位实时渲染

## Goal

`ChatHeader` 从 `/chat/[id]` page 下沉到 `ChatComposer`,让 `/chat` 与 `/chat/[id]` 都在主区顶部渲染它(占位);`messageCount` / `totalTokens` 用 `runtime.messages` 实时计算,消除新会话发消息后 header「从无到有闪现」的突兀感。

## Background

当前 `/chat/page.tsx` 不渲染 `ChatHeader`,`/chat/[id]/page.tsx` 才渲染。新会话发消息后(即使上一轮已消除重挂),聊天区顶部仍无 header,要等导航/刷新到 `[id]` 才出现——这就是用户感受到的「突兀闪一下」。

## Requirements

- `ChatComposer` 在主区顶部渲染 `ChatHeader`,`/chat` 与 `/chat/[id]` 布局一致。
- `messageCount = runtime.messages.length`;`totalTokens = 聚合 runtime.messages 的 trace.sentTokenEstimate`;均实时。
- 分享按钮:`activeConvId` 有值时启用,新会话(无 id)禁用。
- `ChatHeader.conversationId` 改可选。
- 两个 page 各自提供 `createShareAction`(server action wrapper)传给 `ChatComposer`。

## Acceptance Criteria

- [ ] `/chat` 新会话页:顶部即有 `ChatHeader` 占位(`messageCount=0`、`totalTokens` 不显示)。
- [ ] 发消息后 `messageCount` / `totalTokens` 实时增长,header 不闪、不跳变。
- [ ] 建会前分享按钮禁用;建会后(`activeConvId` 有值)可用并能复制分享链接。
- [ ] `/chat/[id]` 历史页 header 显示与之前一致(消息数、token、分享)。
- [ ] `pnpm lint && pnpm typecheck` 通过。

## Out of Scope

- 侧栏「真实标题」异步更新(后台 title 生成后自动刷新侧栏、不等导航):涉及轮询/客户端会话列表缓存,复杂度高,另开任务。当前侧栏新会话项用首条消息前缀作临时标题,可接受。

## Notes

- `ChatMessage.trace.sentTokenEstimate` 已有(`features/chat/model/types.ts:25`),`totalTokens` 直接聚合即可,参考 `/chat/[id]/page.tsx:69-72` 的算法。
- `ChatHeader` 自带 `border-b` + padding(`ChatHeader.tsx:38`),放主区顶部即可,无需额外包裹。
