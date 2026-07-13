# Implement — 新会话发消息消除跨segment重挂

执行前 `trellis-before-dev` 载入 frontend spec（state-management 的 selector 稳定性约定）。

## 改动清单

### Step 1 — `src/features/chat/store/chatStreamStore.ts`

- [ ] `ChatStreamState` 加 `activeConversationId: string | null`（初值 null）+ `optimisticConversation: { id; title; createdAt } | null`（初值 null）。
- [ ] `send` 内 `createConversation` 成功后（migrate 前/后），set 这两个字段：`activeConversationId=resolvedConvId`、`optimisticConversation={ id, title: titleFrom(text), createdAt }`。
- [ ] 加局部 helper `titleFrom(text)`：trim + 折叠空白 + 去引号 + 截断 16 字符（参考 DEEIX `conversationTitleFromFirstUserMessage`）。
- [ ] `hydrate` 时：若 key !== NEW_CONVERSATION_KEY 且 `optimisticConversation?.id === key`，清掉 optimistic（SSR 已带真实数据）。
- verify: `pnpm typecheck`

### Step 2 — `src/features/chat/hooks/useChatRuntime.ts`

- [ ] 加 `const wasNewConversation = useRef(conversationId === null)`（挂载时判定，不随后续 conversationId 变化改）。
- [ ] streaming effect：恢复 refresh 调用，但 `if (wasNewConversation.current) return;`（替换临时验证的注释）。保留 `prevStreamingRef` 更新。
- [ ] `send` 内 `onTitleUpdated` 回调：`() => { if (!wasNewConversation.current) router.refresh(); }`。
- [ ] `onConversationCreated` 保持（replaceState + 外部回调）。
- verify: `pnpm typecheck`

### Step 3 — `src/features/chat/components/Sidebar.tsx`

- [ ] import `useChatStreamStore`。
- [ ] 订阅 `activeConversationId` + `optimisticConversation` + streaming keys（注意 selector 返回稳定引用：streaming ids 用 `useShallow` 返回数组，或 useMemo 派生 Set）。
- [ ] 高亮：`isActive = c.id === activeConversationId`（fallback `usePathname` 解析，当 activeConversationId 为 null）。
- [ ] 列表合并：`optimisticConversation` 且 id 不在 conversations → 插入「今天」分组顶部，generating=true。
- [ ] generating 显示：`c.generating || streamingIds.has(c.id)`。
- verify: `pnpm typecheck` + 手动

### Step 4 — 质量检查

- [ ] `pnpm lint && pnpm typecheck` 通过。
- [ ] 手动回归（见 prd Acceptance Criteria）。

## 回归用例（手动）

- [ ] 新会话发消息：header/消息全程连续不闪；流结束也不闪。
- [ ] 侧栏：新会话立即出现 + 转圈；高亮跟随；流结束转圈停。
- [ ] 历史会话 regenerate：侧栏转圈 + 完成 + 蓝点行为不变。
- [ ] 刷新 `/chat/{id}`：正常加载历史。
- [ ] 后台会话完成蓝点：仍工作。

## 回滚点

每步独立。整体回滚 = 恢复 useChatRuntime 的无条件 refresh + 移除 store 字段 + Sidebar 还原 usePathname。
