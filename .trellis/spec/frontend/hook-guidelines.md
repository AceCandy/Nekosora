# Hook Guidelines

> Nekusora 自定义 hook 约定。

---

## Overview

hook 归属特性的 `hooks/` 目录（如 `features/chat/hooks/`），用于把复杂的有状态逻辑从组件中抽离。本项目不使用 React Query / SWR，数据获取由 Server Component / Server Action 承担，hook 主要做**运行时适配**与**交互控制**。

---

## Custom Hook Patterns

hook 在本项目分三类（以 `features/chat/hooks/` 为标杆）：

| 类型 | 职责 | 例子 |
|------|------|------|
| 运行时适配层 | 把全局 store 切片适配成组件友好的接口，承担 hydrate / 副作用编排 | `useChatRuntime` |
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

**交互控制器的关键模式**：用 `useRef` 缓存最新值，供高频触发的 effect / handler 读取，避免闭包陈旧。`useChatScrollController` 用 `isAtBottomRef` 在滚动 effect 里读，而不是依赖 state。

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
- 控制器命名为 `use<Behavior>Controller`（`useChatScrollController`）。
- hook 对外只暴露组件真正需要的最小接口；内部 helper 留在文件内不导出。

---

## Common Mistakes

- **在 selector 里返回新对象/数组字面量** → 无限重渲染。用 `useShallow` + 模块级常量兜底（见 state-management）。
- **effect 依赖里漏掉「应只在 key 变化时执行」的意图** → 误把会变的数据列进依赖，导致流式被覆盖。需要时加 `eslint-disable-next-line react-hooks/exhaustive-deps` 并写注释说明原因（chat hook 已有先例）。
- **闭包陈旧值** → 高频 handler（滚动、resize）读 state 会拿到旧值，改读 ref。
- **把应该进 store 的状态留在 hook 本地** → 切路由丢失。跨路由要存活的必须进 zustand。
