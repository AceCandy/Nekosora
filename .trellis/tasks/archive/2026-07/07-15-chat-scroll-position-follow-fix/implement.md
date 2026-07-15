# Implement — 修复聊天新消息中上部定位与流式跟随滚动失效

按 `design.md`(方案 1:移除虚拟滚动 + 接入 `@shadcn/react/message-scroller`)执行。多文件大重构,分步、每步可验证。

## 前置
- 任务已 `task.py start`(in_progress)。
- 工作树:含上一轮的 flex/rAF 试验改动(将整体被本次重写覆盖)。

## 架构要点(实现前确认)
- `MessageScroller.Provider` 放在 **ChatMessageList 内**;`useMessageScroller`/`useMessageScrollerVisibility` 必须在 Provider 内调用 → 由 ChatMessageList 调用后把 `scrollToMessage` / `currentAnchorId` 传给 `ChatOutline`。
- ChatComposer 在 Provider 外,**不调用** message-scroller hooks,也不再管滚动。

## 步骤

1. **依赖**:`npm i @shadcn/react` + `npm rm @tanstack/react-virtual`。
   - 验证:`package.json` 含 `@shadcn/react`、无 `@tanstack/react-virtual`;`npm ls @shadcn/react` 正常。
   - → check:安装成功。

2. **重写 `ChatMessageList.tsx`**:`useVirtualizer` → `MessageScroller.*` 原语,`messages.map` 普通渲染,`Item scrollAnchor={role==="user"} messageId="msg-{i}"`。保留空状态 `WelcomeBlock`、`ErrorBoundary`、现有 className(px-6 pt-8/max-w-4xl/py-4)、选区工具栏、删除确认框。`ChatOutline` 暂留,改在步骤 3。
   - → check:`npm run typecheck`(ChatOutline onJump/activeMessageIndex 暂留旧签名可先传占位)。

3. **改 `ChatOutline.tsx` + ChatMessageList 接线**:`activeMessageIndex`←`useMessageScrollerVisibility().currentAnchorId`(转 index);`onJump`←`useMessageScroller().scrollToMessage("msg-"+idx)`。
   - → check:`npm run typecheck`。

4. **改 `ChatComposer.tsx`**:移除 `useChatScrollController` 调用;`handleSend`/`handleSelectionAsk` 移除 `pinToMessageTop`;移除 scrollRef/messagesEndRef/isNearBottom/ready/onScroll/scrollToBottom 的下传与 `ready` 淡入(或保留独立 `animate-in`,不再依赖 scroll 收敛)。
   - → check:`npm run typecheck`。

5. **删除 `src/features/chat/hooks/useChatScrollController.ts`**。
   - → check:`npm run typecheck`(确认无残留引用)。

6. **静态校验**:`npm run typecheck` + `npm run lint` 均 0 error(仅本次相关告警)。

7. **浏览器实测**(重启 dev server;覆盖 prd 四场景):
   - 新会话发首条短消息 → 用户消息中上部、下方留白。
   - 长回复 → 超过视口后持续跟随底部。
   - 流式中上滑 → 停;滚回底部 → 恢复;回到最新按钮显隐正常。
   - 历史长会话进入 → 贴底,无明显闪动。
   - → check:四场景人工通过。

8. **微调**(按实测):中上部偏移量(`scrollEdgeThreshold`/spacer/`pt-`)、进会话淡入、大纲高亮语义。

## Review Gates
- 步骤 2–5 每步 typecheck 通过再继续。
- 步骤 6 全过后进实测;步骤 7 四场景全过方完成。
- 实现后 dispatch `trellis-check` 独立复核(实现与审查分离)。

## Rollback
- `git checkout -- <改动文件>` + 删新增依赖(`npm rm @shadcn/react`、`npm i @tanstack/react-virtual`)+ 恢复 `useChatScrollController.ts`。
- 无 DB / 迁移 / 不可逆改动。

## 不做
- 不动后端 / SSE / `chatStreamStore` 合批逻辑。
- 不引入 shadcn `Button`/`cn`(用现有 `clsx` + 暮色微澜 token)。
- 不新增自动化测试(以浏览器实测为准)。
