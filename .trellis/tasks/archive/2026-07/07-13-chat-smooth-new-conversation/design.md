# Design — 新会话发消息丝滑进入会话页

## 方案选型

| 方案 | 做法 | 丝滑度 | 改动量 | 结论 |
|---|---|---|---|---|
| A 补丁 | `migrate` 不删旧 key(双写),保留 `router.replace` | 中:不闪欢迎态,但仍有一次 RSC 重载+组件重挂(输入框焦点/滚动位置丢) | 小 | 治标,且双写会破坏「新对话」进入干净页(残留消息),需额外清理 |
| **B 静默换 URL(采用)** | `replaceState` 换 URL + `ChatComposer` 持有可变 `activeConvId`,建会后切订阅键 | 高:等同 GPT/Claude/DEEIX-Chat | 中 | 治本,与现有 store 架构契合 |
| C 单页化 | 合并 `/chat` 与 `/chat/[id]` 为单页 + query 会话 id | 最高 | 大(重写 page、分享链接、侧栏高亮、SSR) | 过度,不采用 |

采用 **方案 B**。

## 改动点

### 1. `src/features/chat/hooks/useChatRuntime.ts`

- `UseChatRuntimeOptions` 增加可选 `onConversationCreated?: (newConvId: string) => void`,供上层(`ChatComposer`)更新活动会话 id。
- `send` 内 `hooks.onConversationCreated`(`useChatRuntime.ts:97-99`)改为:
  ```ts
  onConversationCreated: (newConvId) => {
    // 静默换 URL,不触发 Next.js RSC 导航(避免组件重挂、流式中断)
    window.history.replaceState(null, "", `/chat/${newConvId}`);
    onConversationCreated?.(newConvId);
  }
  ```
  删掉原 `router.replace(...)`。`router` 仍保留用于 streaming 结束后的 `router.refresh()`(`useChatRuntime.ts:59-66`,刷新侧栏列表)。

### 2. `src/features/chat/components/ChatComposer.tsx`

- 新增可变活动会话 id:
  ```ts
  const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConvId);
  ```
- 把所有 `initialConvId` 引用改为 `activeConvId`:
  - `useChatAttachments(activeConvId ?? null)`(`ChatComposer.tsx:110`)
  - `useChatRuntime({ conversationId: activeConvId ?? null, onConversationCreated: setActiveConvId, ... })`(`ChatComposer.tsx:111-115`)
  - 9 处持久化 action 的 `const convId = runtime.conversationId ?? initialConvId`(`ChatComposer.tsx:170/180/195/215/227/238/252/263`)统一改为 `activeConvId`。
    - 说明:`runtime.conversationId` 就是 `activeConvId` 传入 useChatRuntime 的镜像,二者等价;直接用 `activeConvId` 更直观、依赖更少。
- `initialConvId` 仍作为 `useState` 初值,不再单独使用。

### 3. `src/features/chat/store/chatStreamStore.ts`

- **不改**。`migrate`(`chatStreamStore.ts:93-102`)与 `onConversationCreated` 调用时机(`chatStreamStore.ts:197`,migrate 后立即调用)保持不变。

## 建会后数据流时序(验证自洽)

1. `/chat` 页 `ChatComposer` 挂载,`activeConvId=undefined`,useChatRuntime `key=NEW_CONVERSATION_KEY`。
2. 发消息 → `store.send(NEW_CONVERSATION_KEY, ...)`:optimistic 写 `runtimes[NEW_CONVERSATION_KEY]`。
3. `createConversation` 返回 `newId` → `migrate(NEW_CONVERSATION_KEY → newId)`:`runtimes[newId]` 有数据,删 `NEW_CONVERSATION_KEY`。
4. `hooks.onConversationCreated(newId)` → `replaceState('/chat/{newId}')` + `setActiveConvId(newId)`。
5. `setActiveConvId` 触发 re-render:useChatRuntime `key=newId`。
6. useChatRuntime `useEffect([key])` 触发:`hydrate(newId, [])` → `runtimes[newId]` 已存在,跳过(`hydrate` 仅在无数据时注入);`clear(NEW_CONVERSATION_KEY)`(已删,no-op)。
7. 订阅切到 `runtimes[newId]`(有数据),流式 SSE 继续写入 `runtimes[newId]`,UI 连续。
8. 流结束后 `router.refresh()` 刷新侧栏列表,新会话出现。

**全程无组件重挂、无空态。**

## 关键权衡:侧栏「当前会话」高亮

- `Sidebar.tsx:128-132` 的 `activeConvId` 由 `usePathname()` 解析 `/chat/{id}` 得到。
- `window.history.replaceState` **不会**同步到 Next.js 的 `usePathname`(路由状态与原生 history API 不同步)。因此新会话建会后,侧栏不会立即高亮新会话(`usePathname` 仍是 `/chat`),直到下一次真实路由导航。
- **MVP 决策:接受这一限制**。理由:发消息期间用户焦点在聊天区;当前实现下"先跳首页"的闪烁比"侧栏晚点高亮"严重得多;符合 Simplicity First。
- 可选增强(不在本任务):`chatStreamStore` 增加 `activeConversationId` 字段,`ChatComposer` 建会后写入,`Sidebar` 订阅它做高亮(替代 `usePathname` 解析)。若 review 时认为高亮缺失影响体验,再追加。

## 兼容性

- 直接访问/刷新 `/chat/{id}`:走 `/chat/[id]/page.tsx` server component,正常加载历史(不变)。
- 分享链接 `/chat/[id]`:结构不变。
- 浏览器历史:`replaceState` 不入栈,后退不会退回 `/chat` 空新会话页(符合预期)。

## 回滚

改动集中在 `useChatRuntime.ts` 的 `onConversationCreated` 与 `ChatComposer.tsx` 的 `activeConvId`。回滚 = 把 `onConversationCreated` 改回 `router.replace('/chat/${newConvId}')`、`ChatComposer` 改回直接用 `initialConvId`。diff 集中、易回滚。
