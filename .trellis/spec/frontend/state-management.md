# State Management

> Nekusora 前端状态管理约定。

---

## Overview

- **全局状态**：`zustand`（单一 store，按业务域切片）。
- **服务端状态**：不做客户端缓存层。Server Component 直接查库取数，Client Component 经 props 接收；写操作走 Server Action 后 `revalidatePath`。
- **本地状态**：`useState` / `useRef`，仅限单个组件内部。
- **URL 状态**：会话 id 等关键标识走路由参数（`chat/[id]`）。

不引入 React Query / SWR。SSR + Server Action + zustand 已覆盖数据流需求。

---

## State Categories

| 类别 | 落地方式 | 典型场景 |
|------|----------|----------|
| 全局客户端状态 | zustand store | 聊天流式运行时（多会话并行） |
| 服务端状态 | SSR 注入 props + revalidate | 会话列表、配置项 |
| 本地 UI 状态 | useState / useRef | 浮层开关、输入框草稿、滚动位置 |
| URL 状态 | 路由参数 | 当前会话 id |

---

## When to Use Global State

仅当满足以下任一时才进 zustand store：

1. **跨路由持久**：切走再回来要保留进行中的状态（如聊天流式：切会话不断流）。
2. **跨组件共享且有写入**：多个非父子组件都要读写同一份状态。

否则用本地 state 或 props 传递。聊天 store 之所以全局化，正是因为它需要在会话切换时维持流式连接。

---

## zustand 使用约定

**单 store 按业务域切片**：每个特性一个 store（如 `features/chat/store/chatStreamStore.ts`），不建跨特性的上帝 store。

**多实例隔离用 keyed record**：同一种状态有多份并行实例时，按稳定 key 索引而非数组。聊天 store 的核心结构：

```ts
interface ChatStreamState {
  runtimes: Record<string, ConversationRuntime>;  // conversationId → 运行时
  // CRUD 方法接收 key 参数，内部读写 runtimes[key]
}
```

**selector 返回稳定引用**：用 `useShallow` 订阅切片，且当切片可能为空时返回模块级常量，避免每次渲染新建字面量导致无限重渲染：

```ts
const EMPTY_MESSAGES: ChatMessage[] = [];  // 模块级常量
const { messages, streaming } = useChatStreamStore(
  useShallow((s) => {
    const rt = s.runtimes[key];
    return { messages: rt?.messages ?? EMPTY_MESSAGES, streaming: rt?.streaming ?? false };
  }),
);
```

**跨组件命令式访问**：用 `store.getState().method()` 在 effect/handler 中直接调用，无需经 hook 订阅。

---

## 乐观创建资源后的 URL 同步

新会话(或任何「客户端先乐观渲染、再异步创建持久化资源」)场景，资源创建成功后要把 URL 切到真实路径。**必须用 `window.history.replaceState` 静默换 URL，不要用 `router.replace`**。

**为什么不用 `router.replace`**：App Router 的 `router.replace('/chat/{id}')` 会触发目标 server component 重新查库 + 整段组件重挂。新会话发首条消息时，store 已把 optimistic 数据 `migrate` 到真实 key，但旧组件订阅的临时 key 被清空、新组件又要等 server 加载——这段窗口会闪现空态/欢迎态，并打断进行中的流式。

**正确做法**（`useChatRuntime` 为例）：建会后用 History API 静默换 URL，并回调上层切活动 id：

```ts
onConversationCreated: (newConvId) => {
  // 静默换 URL，不触发 Next.js RSC 导航(避免组件重挂、流式中断)
  window.history.replaceState(null, "", `/chat/${newConvId}`);
  onConversationCreated?.(newConvId);  // 通知上层更新活动 id
}
```

配合：调用方(`ChatComposer`)持有可变「活动 id」state，建会会后切换它，使 hook 订阅 key 与持久化目标一起跟随：

```ts
const [activeConvId, setActiveConvId] = useState(initialConvId);
const runtime = useChatRuntime({
  conversationId: activeConvId ?? null,
  onConversationCreated: setActiveConvId,  // 建会后回写
});
```

store 的 `migrate(临时key → 真实id)` 先于回写执行，活动 id 一切换，订阅正好落在已有数据的真实 key 上——全程无空态、组件不重挂、流式不中断。刷新/直接访问 `/chat/{id}` 仍走 server component 正常加载历史，不受影响。

> **Gotcha**：`usePathname()` **不会**跟随 `window.history.replaceState`（Next 路由状态与原生 history API 不同步）。凡用 `usePathname` 解析当前会话做高亮的 UI（如 `Sidebar`），在乐观建会期间不会立即更新，要等下一次真实路由导航。若需即时跟随，改用由 store 维护的 `activeConversationId` 驱动，而非 `usePathname`。

参考：`docs/cankao/DEEIX-Chat` 的 `use-chat-message-submit.ts` 用同款 `window.history.replaceState` 模式。

---

## Server State

- 读：Server Component 顶层 await service/action，结果序列化后传给 Client Component。
- 写：Server Action 完成后调用 `revalidatePath(path)` 让 Server Component 重取。
- DB 行类型是 `Record<string, unknown>`，传给 Client 前转成显式 DTO（见 type-safety）。

---

## ChatMessage.status 状态机（续写触发）

`ChatMessage.status?: "success" | "interrupted"` 表征一条 assistant 消息的生成状态，缺省视作完整。它是「继续生成」按钮的唯一触发依据。

**渲染契约**：`ChatMessageItem` 仅当 `role === "assistant" && content && status === "interrupted"` 时渲染续写按钮——完整回答（success/缺省）不显示，从源头避免在已结束文本上续写导致重复。

**status 必须双源维护**，单源都会破：

| 来源 | 时机 | 作用 | 位置 |
|------|------|------|------|
| 前端 | `stopGeneration` abort 时把最后一条 assistant 标为 interrupted | 即时显示续写按钮，不等刷新 | `chatStreamStore.ts` |
| 后端 | `/api/chat` finally 用 `finished` 标志落库（收到 finish 事件才 true，否则 interrupted） | 刷新会话后 `getMessages` → SSR 映射 hydrate 带回 status | `api/chat/route.ts` |

```ts
// 后端 status 判定:基于 finish 事件,不是"有没有输出文本"
let finished = false;
for await (const ev of gen) {
  if (ev.type === "finish") finished = true;
  // ...
}
// finally 落库(续写 UPDATE 与普通 INSERT 两处都要用 finished)
status: finished ? "success" : "interrupted",
```

**续写完成的状态流转**（`continueGeneration`）：正常结束 → 把该消息 `status` 转为 `success`（避免对已补全内容再次续写）；被停止中断 → 保持 `interrupted`（可再次续写）。

**为什么**：续写把目标 assistant 已有正文作为 messages 末尾的 assistant prefill。当 prefill 是被截断的半句话（interrupted）时，模型自然续写、不重复；当 prefill 是一段已完整结束的回答时，模型倾向复述，导致续写内容与原文雷同。因此续写必须限制在 interrupted 消息上。

---

## Common Mistakes

- **在完整回答上允许续写** → prefill 是已结束的整段文本，模型续写时复述原文、内容雷同。续写按钮必须仅 `status === "interrupted"` 时渲染。
- **后端 status 用「有没有输出文本」判定** → 中断但已生成部分内容的消息被误判 success，刷新会话后前端丢 interrupted 标记、续写按钮消失。必须用「是否收到 finish 事件」判定。
- **selector 里返回新对象/数组字面量** → zustand 判定引用变化，触发无限渲染。改用 `useShallow` + 模块级常量兜底。
- **把流式状态放进组件本地 state** → 切路由组件卸载，流式中断。必须进全局 store。
- **在 store 里存不可序列化的 server-only 对象** → store 是 client 域，只能存纯数据 + `AbortController` 这类浏览器对象。
- **忘记 `revalidatePath`** → Server Action 写库后页面不刷新。
- **乐观创建资源后用 `router.replace` 同步 URL** → 触发 RSC 重载 + 组件重挂，新会话发消息时闪欢迎态、打断流式。改用 `window.history.replaceState` 静默换 URL，配合组件持有可变活动 id 切订阅 key（见上「乐观创建资源后的 URL 同步」）。
