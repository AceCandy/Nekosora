# 修复会话标题实时更新：技术设计

## 边界与原则

- 保留 `/api/chat -> durable outbox -> pg-boss -> worker` 的现有标题生成链路。
- 数据库中的 `conversations.title` 与 `conversation_title_jobs` 仍是标题值和任务状态的事实源。
- 不延长聊天 SSE，不让主回答等待标题任务，不引入 WebSocket、Redis Pub/Sub 或 LISTEN/NOTIFY。
- 只为新会话乐观标题增加一个有界、按会话 ID 鉴权的查询与轮询链路。

## 数据流

```text
首条消息
  -> createConversation + optimisticConversation(首句截断)
  -> POST /api/chat 写 fallback + title outbox
  -> fetch 获得成功响应后启动标题轮询
  -> Server Action requireSession
  -> title service 按 userId + conversationId 查询 title 与匹配 outbox
  -> pending: 1 秒后继续
  -> settled: 覆盖 optimisticConversation.title 并停止
  -> Sidebar / ChatHeader 通过 zustand 订阅即时重渲染
```

## 服务端契约

在 `src/lib/conversation-title/service.ts` 增加只读状态查询：

```ts
interface ConversationTitleState {
  title: string;
  pending: boolean;
}

getConversationTitleState(userId, conversationId): Promise<ConversationTitleState | null>
```

- 查询必须同时匹配 `conversationId` 与 `userId`；不存在和无权访问统一返回 `null`。
- `pending` 仅在当前 outbox 存在，且当前标题仍可被该 job 替换时为 `true`。
- 如果用户已手动改名，即使旧 job 尚未被 worker 清理，也返回当前人工标题且 `pending=false`，客户端立即收敛并停止。
- 查询不写库、不删除 job，不改变 worker fencing 语义。

在 `src/features/chat/actions/conversations.ts` 增加薄 Server Action：先 `requireSession()`，再调用标题 service；客户端不接触 DB schema。

## 客户端轮询

- `chatStreamStore.send` 只在本次发送新建了真实会话、且 `/api/chat` 已返回成功响应后启动轮询，避免 fallback/outbox 尚未提交的竞态。
- 轮询任务按 conversationId 保存在 store 模块生命周期内，不依赖当前路由或聊天组件实例；会话切换、组件重挂不得取消任务。
- 立即查询一次，未完成时每 1000ms 串行查询；同一轮不允许重叠请求。
- 最多持续 1 分钟。唯一停止条件是服务端确认标题 settled，或达到 1 分钟上限。
- 每次拿到属于当前乐观会话的标题都可覆盖 store；最终 settled 响应保证 ChatHeader 与 Sidebar 收敛。
- 返回 `null`、无权访问或单次查询异常都不影响聊天流，也不构成提前停止条件；下一轮继续，达到上限后静默保留 fallback。
- 页面运行时销毁不会影响 worker/outbox；后台标题生成始终独立继续。

## 兼容性与竞态

- 标题生成早于第一次查询完成：查询直接返回最终标题和 `pending=false`，一次收敛。
- 人工改名先于 worker：服务端状态查询识别当前标题不再可替换，返回人工标题并停止；worker 原有条件写继续防止覆盖。
- worker/provider 失败：outbox 保留，轮询有界继续；聊天回答不受影响。
- 其他 conversationId：轮询继续执行，但客户端在写 store 前比较乐观项 ID，不允许串写；切回或侧栏仍持有原乐观项时可正常收敛。
- 现有 `title_updated` SSE 消费能力保留为兼容路径，但不再作为后台 worker 完成通知的唯一机制；相关误导注释和前端规范同步修正。

## 回滚

- 删除新增只读查询、Server Action 与客户端轮询调用即可回到当前行为。
- 不涉及 schema、迁移或持久数据格式，回滚不需要数据处理。

## 风险

- 浏览器后台会节流 timer，因此后台标签页不保证 1 秒延迟；回到前台后的下一轮会收敛。
- worker 在 1 分钟后才恢复成功时，当前轮询已经停止，但 worker/outbox 不受影响；需后续导航/刷新读取最终标题。这是有界请求与极端恢复延迟之间的明确取舍。
