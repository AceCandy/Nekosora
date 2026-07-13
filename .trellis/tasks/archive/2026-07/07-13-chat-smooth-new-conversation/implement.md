# Implement — 新会话发消息丝滑进入会话页

执行前用 `trellis-before-dev` 载入 `frontend` 层 spec。改动遵循 surgical 原则,只动下列文件。

## 改动清单

### Step 1 — `src/features/chat/hooks/useChatRuntime.ts`

- [ ] `UseChatRuntimeOptions` 加 `onConversationCreated?: (newConvId: string) => void`。
- [ ] `send` 的 `hooks.onConversationCreated`(当前 `router.replace('/chat/${newConvId}')`)改为:
      `window.history.replaceState(null, "", '/chat/${newConvId}')` + 调用外部 `onConversationCreated?.(newConvId)`。
- [ ] 保留 `useRouter`,`router.refresh()` 逻辑(`:59-66`)不动。
- [ ] 调整 `send` 的 `useMemo` 依赖数组:加入新的 `onConversationCreated`。
- verify: `pnpm typecheck`

### Step 2 — `src/features/chat/components/ChatComposer.tsx`

- [ ] 加 `const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConvId);`。
- [ ] `useChatAttachments(initialConvId ?? null)` → `useChatAttachments(activeConvId ?? null)`。
- [ ] `useChatRuntime({ conversationId: initialConvId ?? null, ... })` → `conversationId: activeConvId ?? null`,并加 `onConversationCreated: setActiveConvId`。
- [ ] 9 处 `const convId = runtime.conversationId ?? initialConvId;`(`:170/180/195/215/227/238/252/263`)统一改为 `const convId = activeConvId;`。
- verify: `pnpm typecheck`(确认 `initialConvId` 无残留未用引用)

### Step 3 — 质量检查

- [ ] `pnpm lint && pnpm typecheck` 通过。
- [ ] 若有 `useChatRuntime` / `ChatComposer` 相关测试,跑 `pnpm test -- <path>`;无则跳过。

## 回归用例(手动,dev 环境)

建会话场景:
- [ ] `/chat` 发首条消息:URL 立即变 `/chat/{id}`,无欢迎态闪烁,流式连续。
- [ ] 建会后切换模型/推理档位/输出模式/参数 → 刷新页面,设置仍在(DB 落库成功)。
- [ ] 流式进行中刷新页面:能从 `/chat/{id}` 正常恢复历史 + 继续看后续生成。
- [ ] 建会后点浏览器后退:不退回空 `/chat`(replace 不入栈)。

既有流程不回归:
- [ ] 侧栏点历史会话:正常加载历史(`router` 导航不变)。
- [ ] 历史会话里 regenerate / edit / 停止生成:行为不变。
- [ ] 侧栏「新对话」按钮:进入干净 `/chat`,无上一轮残留消息。
- [ ] 后台会话蓝点/转圈(侧栏轮询):不受影响。

已知限制(验收时确认可接受):
- [ ] 新会话建会后,侧栏「当前会话」高亮不会立即跟随(usePathname 仍为 `/chat`);流结束后或下次导航后恢复。记录为 MVP 接受项。

## 回滚点

每步独立可回滚。整体回滚 = Step 1 的 `onConversationCreated` 改回 `router.replace` + Step 2 的 `activeConvId` 改回 `initialConvId`。
