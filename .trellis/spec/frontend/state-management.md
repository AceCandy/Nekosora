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

## Server State

- 读：Server Component 顶层 await service/action，结果序列化后传给 Client Component。
- 写：Server Action 完成后调用 `revalidatePath(path)` 让 Server Component 重取。
- DB 行类型是 `Record<string, unknown>`，传给 Client 前转成显式 DTO（见 type-safety）。

---

## Common Mistakes

- **selector 里返回新对象/数组字面量** → zustand 判定引用变化，触发无限渲染。改用 `useShallow` + 模块级常量兜底。
- **把流式状态放进组件本地 state** → 切路由组件卸载，流式中断。必须进全局 store。
- **在 store 里存不可序列化的 server-only 对象** → store 是 client 域，只能存纯数据 + `AbortController` 这类浏览器对象。
- **忘记 `revalidatePath`** → Server Action 写库后页面不刷新。
