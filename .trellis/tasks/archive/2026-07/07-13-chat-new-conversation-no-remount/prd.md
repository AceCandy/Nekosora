# 新会话发消息消除跨segment重挂(refresh引起)

## Goal

新会话发首条消息全程不再发生跨 segment 重挂：header 与消息连续、不闪；同时把侧栏的「新会话项出现 / generating 转圈 / 当前会话高亮」改为客户端乐观驱动，不再依赖 `router.refresh()`。

## Background / 根因

上一轮（`1995bee`）用 `window.history.replaceState` 静默换 URL，但留下两个 `router.refresh()`：
- streaming 开始 400ms 后的 refresh（`useChatRuntime.ts:63`）
- 流结束 `onTitleUpdated` 的 refresh（`useChatRuntime.ts:99`）

`replaceState` 把 `window.location` 改到 `/chat/{id}`，而这两个 `router.refresh()` 读到新 URL，于是跨 segment 把 `/chat` 重挂成 `/chat/[id]`——header 从无到有、消息区空一拍（用户实测确认）。临时禁用 streaming refresh 后首段不闪、但流结束 `onTitleUpdated` refresh 仍闪，完整印证。

## Requirements

- 新会话场景下，不触发任何会跨 segment 重挂的 `router.refresh()`。
- 新会话建会后，侧栏**立即**出现新会话项（乐观，临时标题）+ generating 转圈。
- 流结束后转圈停止；标题由后台写入，下次导航/刷新同步。
- 侧栏当前会话高亮改用客户端 `activeConversationId` 驱动，替代 `usePathname()` 解析（顺带解决 `replaceState` 后高亮不跟随的限制）。
- 历史会话页（`/chat/[id]`）的 refresh 行为不变（URL 本就是 `[id]`，同 segment 不重挂）。
- 刷新 / 直接访问 `/chat/[id]` 仍正常加载历史；分享链接不变。

## Acceptance Criteria

- [ ] 新会话发首条消息：header 与消息全程连续，**无闪现、无空一拍**。
- [ ] 流式过程中 + 流结束后，聊天区都不重挂（输入框焦点、滚动位置保留）。
- [ ] 侧栏：新会话建会后立即出现该会话项 + generating 转圈（乐观）。
- [ ] 侧栏当前会话高亮，建会后立即跟随到新会话（不再等导航）。
- [ ] 流结束转圈停止；后台生成的标题在下次导航/刷新后可见。
- [ ] 历史会话页发消息（regenerate 等）：侧栏 generating 转圈与完成行为不变。
- [ ] 后台会话完成蓝点（轮询机制）不受影响。
- [ ] `pnpm lint && pnpm typecheck` 通过。

## Out of Scope

- 不做单页化（`/chat?id=`）。当前方案通过「新会话不 refresh + 侧栏乐观」在保留 `/chat/[id]` 路由的前提下根治。

## Notes

- 验证结论已记录：禁用 streaming refresh → 首段不闪；流结束 `onTitleUpdated` refresh → 仍闪。两者都要条件化。
- 参考模式：`docs/cankao/DEEIX-Chat` 的 `prependNewConversation`（建会乐观插入侧栏）+ `conversationTitleFromFirstUserMessage`（临时标题）。
