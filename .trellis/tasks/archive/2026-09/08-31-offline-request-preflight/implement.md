# 浏览器离线预检实施计划

## Step 1: Add Failing Tests

- 创建 `src/features/chat/lib/network.test.ts`，覆盖纯函数边界。
- 扩展 `chatStreamStore.test.ts`：四个动作离线时 Server Action 和 `fetch` 均为零调用。
- 扩展 `ChatComposer.test.tsx`：发送、重新生成、编辑重发、续写与上传显示离线文案并保留可重试状态。

## Step 2: Add The Shared Guard

- 新增一个 `isBrowserOffline` 纯函数和稳定 `browser_offline` 原因码。
- 替换 Sidebar 的本地 `navigator.onLine` 判断。

## Step 3: Guard Chat And Upload

- 在四个 store 动作产生任何状态或 Server Action 前调用 guard。
- 给三个非发送动作补最小拒绝回调，经 `useChatRuntime` 透传到 ChatComposer。
- 上传前调用 guard并沿用现有 error/retry 状态。
- 保持在线路径、AbortController、SSE 和真实网络错误代码不变。

## Step 4: Quality Gate

```bash
pnpm --filter @nekusora/web exec vitest run src/features/chat/lib/network.test.ts src/features/chat/store/chatStreamStore.test.ts src/features/chat/components/ChatComposer.test.tsx
pnpm --filter @nekusora/web typecheck
git diff --check
```

独立复核所有 guard 都早于 Server Action/乐观修改，并确认没有引入监听器或全局在线状态。

## Rollback Point

共享函数、调用点、回调和文案可整体回滚；无服务端或持久层变更。
