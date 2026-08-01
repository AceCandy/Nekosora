# Hook Guidelines

> Nekusora 自定义 hook 约定。

---

## Overview

hook 归属特性的 `hooks/` 目录（如 `features/chat/hooks/`），用于把复杂的有状态逻辑从组件中抽离。本项目不使用 React Query / SWR，数据获取由 Server Component / Server Action 承担，hook 主要做**运行时适配**与**交互控制**。

---

## Custom Hook Patterns

hook 在本项目分四类（以 `features/chat/hooks/` 为标杆）：

| 类型 | 职责 | 例子 |
|------|------|------|
| 运行时适配层 | 把全局 store 切片适配成组件友好的接口，承担 hydrate / 副作用编排 | `useChatRuntime` |
| 局部状态协调器 | 订阅特性内 state machine，并串行编排持久化副作用 | `useComposerCoordinator` |
| 交互控制器 | 管理某一项具体的交互行为（滚动跟随、聚焦等） | `useChatScrollController` |
| 资源收集器 | 收集并转换用户输入（附件、文件等）供发送时上传 | `useChatAttachments` |

**运行时适配层的关键模式**：hook 按 id 订阅全局 store 切片，并把 SSR 初始数据在 mount 时注入 store。store 是真正的状态宿主，hook 只做绑定：

```ts
export function useChatRuntime({ conversationId, initialMessages }) {
  const key = conversationId ?? NEW_CONVERSATION_KEY;
  useEffect(() => {
    useChatStreamStore.getState().hydrate(key, initialMessages);
    // 仅在 key 变化时注入，避免流式中被新 SSR 快照覆盖
  }, [key]);
  // 用 useShallow 订阅 store 切片
}
```

**局部状态协调器的关键模式**：machine 是同步状态宿主，writer 是唯一持久化入口，hook 只暴露只读 snapshot 与领域命令。稳定实例用 lazy `useState` 创建，视图用 `useSyncExternalStore` 订阅；不要把可变 class 实例放进 render 期间重建。

```ts
const [machine] = useState(() => new ComposerStateMachine(initialState));
const [writer] = useState(() => new LatestSnapshotWriter({
  scopeId: conversationId,
  initialSnapshot: initialState,
  write: persistSnapshot,
  equals: composerSelectionsEqual,
}));
const state = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);

function dispatch(transition: ComposerTransition) {
  const previous = machine.getSnapshot();
  const next = machine.dispatch(transition);
  if (next !== previous) writer.update(next);
  return next;
}
```

Coordinator 必须遵守以下生命周期契约：

- `persistSnapshot` prop 变化时只通过 `writer.setWrite` 更新回调，不重建或并行创建 writer。
- effect setup 调用 `resume()`，cleanup 调用 `dispose()`；两者必须可逆，以兼容 React Strict Mode 的 setup-cleanup-setup 重放。
- 新会话创建成功时以首次发送所用的同一 snapshot 调用 `adoptConversation(newId, persistedSnapshot)`；组件不得把创建后的当前 closure 误当成数据库已持久化基线。
- 组件 handler 只调用 `dispatch`、`getSnapshot`、`adoptConversation` 或 `retry`，不得绕过 coordinator 直接调用字段级 Server Action。

**交互控制器的关键模式**：用 `useRef` 缓存最新值，供高频触发的 effect / handler 读取，避免闭包陈旧。`useChatScrollController` 用 `isAtBottomRef` 在滚动 effect 里读，而不是依赖 state。

**资源收集器的 blob URL 生命周期**：调用 `URL.createObjectURL` 后，必须立即登记到未释放 URL Set。附件 state 变化后的 effect 对比当前 active URL，只 revoke 并移出已经离开 state 的资源；hook 卸载时 revoke Set 中剩余资源。state updater 必须保持纯函数，不能在 updater 内 revoke 或修改资源 ref（Strict Mode 可能重复执行 updater）。

```ts
const previewUrl = URL.createObjectURL(file);
previewUrlsRef.current.add(previewUrl);

useEffect(() => {
  const activeUrls = new Set(items.flatMap((item) => item.previewUrl ? [item.previewUrl] : []));
  previewUrlsRef.current.forEach((url) => {
    if (!activeUrls.has(url)) {
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(url);
    }
  });
}, [items]);

useEffect(() => () => {
  previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  previewUrlsRef.current.clear();
}, []);
```

禁止把 `[items]` effect 的 cleanup 写成 revoke 全列表；依赖变化时 React 会先执行旧 cleanup，仍在页面展示的预览会被提前失效。

**滚动到底部的动画选择**：长距离回到底部时，原生 `scrollIntoView({ behavior: "smooth" })` 时长由浏览器决定、偏拖沓。需要更快手感时，用 `requestAnimationFrame` 自定义缓动(easeOutCubic,固定短时长),并对距离为 0 的情况直接瞬时归位:
```ts
function smoothScrollToBottom(el: HTMLElement) {
  const to = el.scrollHeight - el.clientHeight;
  if (to - el.scrollTop <= 0) { el.scrollTop = to; return; }
  // rAF + easeOutCubic,时长按手感固定(如 280ms)
}
```
注意:流式高频跟随仍用 `behavior: "auto"`(瞬时),避免和自定义缓动抢帧;自定义缓动只用于「用户主动触发的单次回到底部」。

---

## Data Fetching

不在 hook 里做数据获取。读数据走 Server Component（await service），写数据走 Server Action。hook 只处理已经在客户端的状态。

---

## Naming Conventions

- 命名 `useXxx`，文件 `useXxx.ts`，camelCase。
- 运行时适配层命名为 `use<Domain>Runtime`（`useChatRuntime`）。
- 局部状态协调器命名为 `use<Domain>Coordinator`（`useComposerCoordinator`）。
- 控制器命名为 `use<Behavior>Controller`（`useChatScrollController`）。
- hook 对外只暴露组件真正需要的最小接口；内部 helper 留在文件内不导出。

---

## Common Mistakes

- **在 selector 里返回新对象/数组字面量** → 无限重渲染。用 `useShallow` + 模块级常量兜底（见 state-management）。
- **effect 依赖里漏掉「应只在 key 变化时执行」的意图** → 误把会变的数据列进依赖，导致流式被覆盖。需要时加 `eslint-disable-next-line react-hooks/exhaustive-deps` 并写注释说明原因（chat hook 已有先例）。
- **闭包陈旧值** → 高频 handler（滚动、resize）读 state 会拿到旧值，改读 ref。
- **只按顶层 `react` 类型/导出使用新 hook** → Next 15 客户端实际加载 `next/dist/compiled/react`，两者导出可能不同；例如顶层 React 19.2 有 `useEffectEvent`，Next 内置运行时却没有，类型检查通过但浏览器报 `is not a function`。共享 hook 应使用当前 Next 运行时已支持的稳定 API；稳定事件回调采用 `useRef` 保存最新函数，并可用 `node -e "console.log(typeof require('next/dist/compiled/react').<api>)"` 核验运行时导出。
- **把应该进 store 的状态留在 hook 本地** → 切路由丢失。跨路由要存活的必须进 zustand。
- **把局部 coordinator 强行放进全局 store** → 生命周期与 conversation scope 脱钩。只服务当前组件树、需要同步 snapshot/顺序副作用的状态保留在特性内 machine；真正跨路由存活的运行时才进 zustand。
- **Strict Mode cleanup 后永久停用 writer** → 开发环境 effect 重放后不再持久化。writer 必须提供可逆的 `resume()` / `dispose()`，并用 generation fencing 忽略旧请求回调。
