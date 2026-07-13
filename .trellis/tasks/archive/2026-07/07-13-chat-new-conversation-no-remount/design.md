# Design — 新会话发消息消除跨segment重挂

## 方案总览

保留 `/chat` 与 `/chat/[id]` 双路由。新会话场景下**不触发 `router.refresh()`**（消除跨 segment 重挂），侧栏改客户端乐观驱动。

| 层 | 改动 |
|---|---|
| `useChatRuntime.ts` | 识别「新会话页」（初始 conversationId=null），该场景跳过 streaming refresh + onTitleUpdated refresh；历史会话页不变 |
| `chatStreamStore.ts` | 加 `activeConversationId` 字段；`send` 建会时写入 activeId + optimistic 会话项（id + 临时标题 + generating） |
| `Sidebar.tsx` | 订阅 store：高亮用 `activeConversationId`；新会话项乐观合并；generating 转圈用 store streaming 覆盖 SSR |

## 改动点

### 1. `useChatRuntime.ts`

- 加 `const wasNewConversation = useRef(conversationId === null)`（挂载时判定；新会话页 initialConvId 为空 → true，历史会话页 → false）。
- streaming effect 的 refresh：`if (wasNewConversation.current) return;`（跳过；临时验证改动替换为正式条件化）。
- `send` 内 `onTitleUpdated` 回调：同样 `if (wasNewConversation.current) return;`（跳过 refresh；标题靠 store optimistic + 后台写入）。
- `onConversationCreated` 回调里，调外部 `onConversationCreated?.(newConvId)` 前/后，**由 store 写入 activeConversationId**（见下）——实际上 store.send 内部 migrate 时已知道 newConvId，直接在那里 set activeId 最干净，不必经 hook。

### 2. `chatStreamStore.ts`

- `ChatStreamState` 加：
  - `activeConversationId: string | null`（当前活跃会话，建会写入；Sidebar 高亮用）
  - `optimisticConversation: { id: string; title: string; createdAt: number } | null`（建会乐观项；Sidebar 合并用）
- `send` 内 `createConversation` 成功后（migrate 附近）：
  ```ts
  set((s) => ({
    activeConversationId: resolvedConvId,
    optimisticConversation: { id: resolvedConvId, title: titleFrom(text), createdAt: Date.now() },
  }));
  ```
  - `titleFrom(text)`：首条用户消息前缀（≤16 字符，参考 DEEIX），作为乐观标题。
- 流结束（finally）不清 optimistic（让 Sidebar 保留项直到 SSR 带真实数据覆盖）；Sidebar 合并时以 SSR 命中为优先去重。
- `hydrate` 时若 key 已在 SSR（真实会话加载），清掉同 id 的 optimistic 残留（避免重复）。

### 3. `Sidebar.tsx`

- 订阅 store（`useShallow`）：
  ```ts
  const { activeConversationId, optimisticConversation, streamingIds } = useChatStreamStore(useShallow((s) => ({
    activeConversationId: s.activeConversationId,
    optimisticConversation: s.optimisticConversation,
    streamingIds: new Set(Object.entries(s.runtimes).filter(([, r]) => r.streaming).map(([k]) => k)),
  })));
  ```
  - `streamingIds` 注意返回 Set 字面量需稳定（用模块级或 useMemo；或改为返回数组 + useShallow 浅比较）。
- 高亮：`isActive = c.id === activeConversationId`（替代 `usePathname` 解析）。`usePathname` 可保留作为 fallback（activeConversationId 为 null 时）。
- 列表合并：若 `optimisticConversation` 且其 id 不在 SSR `conversations` 中，插入到「今天」分组顶部（generating=true）。
- generating 转圈：`c.generating || streamingIds.has(c.id)`（store streaming 覆盖 SSR，新会话也能转）。
- 后台轮询（`getGeneratingStatusesAction`）逻辑保留，但注意它依赖 `hasGenerating`（SSR）；新会话场景 SSR 不更新，轮询不启动——可接受（乐观转圈已由 store 提供）。

## 数据流（新会话发消息）

1. `/chat` 发消息 → store.send：optimistic user msg → `runtimes[NEW]`。
2. `createConversation` → `resolvedConvId`：set `activeConversationId` + `optimisticConversation`；`migrate(NEW → resolvedConvId)`；`replaceState('/chat/{id}')`；外部 `onConversationCreated(setActiveConvId)`。
3. Sidebar 订阅到 activeId + optimistic → 立即高亮 + 插入新会话项 + 转圈（streaming）。
4. 流式写入 `runtimes[resolvedConvId]`，ChatComposer 订阅连续。**无 refresh，无重挂。**
5. 流结束：`runtimes[resolvedConvId].streaming=false` → 转圈停。`wasNewConversation` 跳过 onTitleUpdated refresh。
6. 后台异步写 title；下次 navigation/刷新 SSR 带真实 title，覆盖 optimistic。

## 兼容性

- 历史会话页：`wasNewConversation=false`，refresh 行为完全不变。
- 刷新 `/chat/{id}`：SSR 加载，`optimisticConversation` 为 null（store 是内存，刷新清空），正常显示。
- 分享链接 `/chat/[id]` 不变。
- `usePathname` 保留作为高亮 fallback，不破坏现有导航高亮。

## 风险

- `streamingIds` selector 稳定性：必须用 `useShallow` 或返回稳定引用，否则无限渲染。
- optimistic 与 SSR 去重：以 id 为键，SSR 命中则不显示 optimistic（避免重复项）。
- 若用户在新会话流式中刷新页面：URL 已是 `/chat/{id}`，SSR 加载（user msg 已落库），assistant 可能未写完 → 显示已有部分，流断。这是既有行为，不在本任务范围。
