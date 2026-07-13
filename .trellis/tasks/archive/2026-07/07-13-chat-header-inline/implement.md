# Implement — ChatHeader 下沉

## Step 1 — `ChatHeader.tsx`
- [ ] `conversationId: string` → `conversationId?: string`。
- [ ] 分享按钮 `disabled` 加 `|| !conversationId`;`handleShare` 加 `if (!conversationId) return;`。

## Step 2 — `ChatComposer.tsx`
- [ ] `import ChatHeader`。
- [ ] `ChatComposerProps` 加 `createShareAction: (id: string) => Promise<string>`;解构取出。
- [ ] 加 `totalTokens` useMemo(聚合 `m.trace?.sentTokenEstimate`)。
- [ ] `return` 主区顶部插 `<ChatHeader conversationId={activeConvId} messageCount={runtime.messages.length} totalTokens={totalTokens} createShareAction={createShareAction} />`。

## Step 3 — `src/app/chat/page.tsx`
- [ ] `import { createShare }`。
- [ ] 加 `handleCreateShare` server action wrapper。
- [ ] `<ChatComposer ... createShareAction={handleCreateShare} />`。

## Step 4 — `src/app/chat/[id]/page.tsx`
- [ ] 移除 `<ChatHeader .../>` 渲染块。
- [ ] `<ChatComposer ... createShareAction={handleCreateShare} />`。
- [ ] 移除不再使用的 `ChatHeader` import。

## Step 5 — 质量检查
- [ ] `pnpm lint && pnpm typecheck`。
- [ ] 手动:/chat 顶部 header 占位;发消息实时增长;分享按钮建会前后状态;历史页一致。

## 回滚点
每步独立。整体回滚 = ChatComposer 移除 ChatHeader + 恢复 [id]/page.tsx 独立渲染。
