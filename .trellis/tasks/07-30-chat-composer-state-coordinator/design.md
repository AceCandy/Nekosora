# Chat Composer State Coordinator Design

## Boundary

本任务把 Composer 的生成选择收敛为一个深模块，边界内包含：

- 选择状态与纯 transition reducer。
- 从权威状态同步读取 send/persist snapshot。
- 每个 Composer 生命周期一个 latest-only 持久化队列。
- 新会话临时 scope 到真实 conversation ID 的采用。
- 持久化 dirty/error/retry 状态。

输入文本、附件、消息流、浮层和 artifact panel 保持原 owner，不迁入 coordinator。

## State Contract

```ts
interface ComposerSelectionState {
  modelId: string;
  cardIds: string[];
  kbIds: string[];
  webSearch: boolean;
  outputModeId: string | null;
  renderStyleId: string | null;
  reasoningByModelId: Record<string, ReasoningLevel>;
}
```

Reducer 只接受领域 transition：select model、toggle card、toggle KB、toggle web search、select output mode、select render style、set model reasoning。数组保持现有点击顺序，不做无需求的排序。

Coordinator 同时维护同步 ref。`dispatch()` 在安排 React render 前先计算并写入 ref，因此连续事件、发送和持久化永远读取同一个最新 snapshot，不依赖 render closure 是否已刷新。

当前模型的 `modelName` 与有效 reasoning 是派生值：modelName 从 `models` 反查；reasoning 继续调用 `resolveReasoningForModel`，不复制模型目录规则。

## Persistence Contract

新增一个完整快照 Server Action，替代六条 Composer 独立写路径：

```ts
saveConversationComposerState(conversationId, {
  modelName,
  outputModeId,
  renderStyleId,
  webSearch,
  cardIds,
  kbIds,
  reasoningByModelId,
})
```

Action 在边界校验 conversation ID、nullable IDs、布尔值、字符串数组和 reasoning map，校验当前用户属主后执行一次 `UPDATE conversations SET ...`。`composerState` 整体写为 `{ cardIds, kbIds, reasoningByModelId }`，不先读旧 JSON，因此 card/KB/reasoning 不再互相丢失更新。

旧的 `setConversationOutputMode`、`setConversationRenderStyle`、`setConversationModel`、`setConversationWebSearch`、`setConversationComposerState` 和 `setConversationModelReasoning` 在确认无其他调用后删除。非 Composer 会话 Action 不改。

## Latest-Only Writer

Writer 属于一个 ChatComposer 实例，持有：

- 当前 scope conversation ID，空白新会话时为 null。
- 当前 in-flight snapshot。
- 至多一个 pending latest snapshot；新 enqueue 覆盖旧 pending。
- last persisted fingerprint、dirty snapshot 与 sync status。

规则：

1. scope 为 null 时只更新本地状态，不发持久化请求。
2. 已有 scope 的 transition 立即 enqueue 完整 snapshot。
3. 无请求在途时立即发送；有请求在途时只替换 pending latest。
4. 成功后标记该 snapshot 已持久化；若 pending 与其不同，再发送 pending。
5. 失败后停止 drain，保留当前最新 dirty snapshot 并进入 error；不回滚 UI。
6. retry 或下一次 transition 重新启动 drain，并只发送当时最新 snapshot。
7. 旧请求的 UI callback 以 writer 实例/sequence fencing；实例卸载后不得更新其他 Composer。

单写队列从机制上消除同一 Composer 的请求乱序；完整快照 Action消除同一行内 JSON 局部写覆盖。因此本任务不需要数据库 revision。

## Conversation Lifecycles

### Existing Conversation

SSR snapshot 创建 coordinator，并视为已持久化基线。每次 transition 乐观更新 UI 并 enqueue 完整快照。

### Blank Conversation

`/chat` 使用默认 initial snapshot，不从上一会话读取选择。ID 为空时 transition 只改变 draft snapshot。

首次 send 从 coordinator 同步读取 snapshot，并把它传给现有 `createConversation`。创建成功后调用 `adoptConversation(newId, createSnapshot)`：

- 当前 snapshot 等于 createSnapshot：只设置 scope，无冗余写。
- 创建期间用户又改变选择：设置 scope 后立即 enqueue 当前最新 snapshot。

### A/B Navigation

`chat/[id]/page.tsx` 用 conversation ID 作为 `ChatComposer` key，明确让 A/B 导航重建 coordinator 并从 B 的 SSR snapshot 初始化。A writer 已发送的请求仍只携带 A ID；其后续 callback 被旧实例 fencing，不能污染 B。

新会话的 `history.replaceState` 不触发 RSC 导航，故不会因 key 规则重挂；仍由 `adoptConversation` 保持流式和选择连续性。

## Send Contract

普通 send 与 selection ask 在事件发生时调用 `getSnapshot()`，一次性派生 modelName、cardIds、kbIds、webSearch、output/render 和 effective reasoning。内部 WebChat `/api/chat` 请求在现有字段之外新增两个可选字段：

```ts
{
  outputModeId?: string | null;
  reasoning?: ReasoningLevel;
}
```

新 ChatComposer 每次都显式发送两字段，包含 `null` 与 `off`，使请求语义来自点击发送时的同一 coordinator snapshot。route 在 JSON 边界验证 nullable ID 与 reasoning 枚举：字段存在时优先使用 body；字段缺省时才回退 conversation row/composerState，保持旧 WebChat 调用兼容。`prepareChatContext` 接收解析后的 effective outputModeId，reasoning 写入同一轮 IR request。

发送不等待 Composer persistence 成功，因此设置网络故障不会阻塞聊天；持久化失败状态继续可见并可重试。公开 `/v1/*` 路由与 wire contract 不受影响。

edit/regenerate/continue 继续使用消息自身 modelId/name，不改成当前 Composer snapshot，保持现有分支语义。

## Failure UX

持久化失败后，在输入框 top content 的现有错误区域显示紧凑 `role="alert"` 状态、AlertCircle 和带重试图标/文案的命令。错误只使用本地化稳定文案，不渲染或记录 raw error。选择器保持可操作，用户下一次变化会合并到 dirty snapshot 并再次尝试。

发送错误与 Composer sync 错误使用独立状态，避免一个成功误清另一个错误；布局沿用现有 caption/error token，不重设计 Toolbar。

## Compatibility

- 内部 `/api/chat` 增加向后兼容的可选 snapshot 字段；公开 `/v1/*` wire shape 不变。
- conversations 现有列和 JSON shape 不变，无 Drizzle migration。
- model catalog 仍是 reasoning levels/default/clamp 的唯一事实源。
- React state 保持局部，不引入新 Zustand slice、React Query 或第三方队列依赖。
- Toolbar、ChatInputBox 和消息编辑接口保持原 props 语义。

## Rollback

产品提交应用前可整笔回滚：恢复 ChatComposer 独立 state/actions，并删除新增 coordinator 模块与测试。没有 schema/data migration。

若实施中发现完整 Action 有未识别的外部调用方，停止删除旧 Action；先迁移并验证调用方，不添加双写兼容层。若 browser 回归发现 key 重建破坏流式，保留 coordinator scope fencing并重新核对实际 RSC 生命周期，不回退到隐式 prop 复用。

## Tradeoffs

- 不解决多标签页并发：跨标签不存在单一“最后可见”顺序，需独立的 server revision/product policy，超出本任务。
- 不后台无限自动重试：避免隐藏流量和卸载后重试；用户重试或下一次明确操作驱动再次提交。
- 使用完整快照而非字段 patch：payload 很小，换取原子性、可审计性和删除 JSON 读改写竞态。
- 请求显式携带生成所需 snapshot，而不是发送前强制等待持久化：避免同步故障阻塞聊天，并保证本轮 output mode/reasoning 与用户点击时一致。
