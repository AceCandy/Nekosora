# State Management

> Nekusora 前端状态管理约定。

---

## Overview

- **全局状态**：`zustand`（单一 store，按业务域切片）。
- **服务端状态**：不做客户端缓存层。Server Component 直接查库取数，Client Component 经 props 接收；写操作走 Server Action 后 `revalidatePath`。
- **局部状态**：简单状态使用 `useState` / `useRef`；需要同步快照与副作用排序时，可使用特性内 state machine + `useSyncExternalStore`，但生命周期仍不得越过所属组件树。
- **URL 状态**：会话 id 等关键标识走路由参数（`chat/[id]`）。

不引入 React Query / SWR。SSR + Server Action + zustand 已覆盖数据流需求。

---

## State Categories

| 类别 | 落地方式 | 典型场景 |
|------|----------|----------|
| 全局客户端状态 | zustand store | 聊天流式运行时（多会话并行） |
| 局部协调状态 | state machine + `useSyncExternalStore` | Composer 选择快照与持久化队列 |
| 服务端状态 | SSR 注入 props + revalidate | 会话列表、配置项 |
| 本地 UI 状态 | useState / useRef | 浮层开关、输入框草稿、滚动位置 |
| URL 状态 | 路由参数 | 当前会话 id |

---

## When to Use Global State

仅当满足以下任一时才进 zustand store：

1. **跨路由持久**：切走再回来要保留进行中的状态（如聊天流式：切会话不断流）。
2. **跨组件共享且有写入**：多个非父子组件都要读写同一份状态。

否则用局部 state、局部 coordinator 或 props 传递。聊天 store 之所以全局化，正是因为它需要在会话切换时维持流式连接；Composer 选择只服务当前组件生命周期，不得仅因逻辑复杂就迁入 zustand。

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

## Composer 局部协调状态

Chat Composer 的六类生成选择由 `ComposerStateMachine` 持有一个完整 `ComposerSelectionState`。组件只通过领域 transition 更新；普通发送和选区追问必须在事件发生时调用同步 `getSnapshot()`，不得从多个 render closure 拼装请求参数。

```ts
interface ComposerSelectionState {
  modelId: string;
  cardIds: string[];
  webSearch: boolean;
  outputModeId: string | null;
  renderStyleId: string | null;
  reasoningByModelId: Record<string, ReasoningLevel>;
}

const next = machine.dispatch(transition);
writer.update(next);
```

**持久化契约**：每个 Composer 实例只创建一个 `LatestSnapshotWriter`。同一时刻最多一个请求在途；期间的新变化只保留最新完整快照。失败保留最新 dirty snapshot 并进入 `error`，用户重试或下一次 transition 只提交当时最新快照，不回滚 UI，也不在组件 handler 中另开字段级写入。

**scope 隔离**：writer 以 conversation ID 为 scope，并用 generation token 忽略旧 scope 请求的完成回调。历史会话 A/B 导航由 `chat/[id]/page.tsx` 的 conversation ID `key` 重建 Composer；旧实例的成功、错误或重试不得改变新实例。

**新会话 create/adopt**：首次发送前捕获同一个 immutable selection snapshot，同时用于创建会话和本轮发送。创建成功后先调用 `adoptScope(realConversationId, createSnapshot)`，再切换活动会话 ID；若创建期间本地选择已变化，writer 只向真实 ID 补写最新快照。`history.replaceState` 不触发组件重挂，因此 draft 到真实 ID 必须走 adopt，不能依赖 SSR 重新初始化。

Composer 的选择保存是高频乐观持久化：Server Action 成功后不 `revalidatePath`，当前 machine 继续作为页面内权威状态；刷新或 A/B 重挂时再从 SSR snapshot 初始化。

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

**乐观项标题的异步刷新**：新会话乐观项的初始标题是首条消息截断（store 内 `titleFrom`）。标题由独立 worker 写库，聊天 SSE 与 worker 不共享请求生命周期，因此 `/api/chat` 成功响应后由 store 按 `conversationId` 每秒短轮询标题状态，最多一分钟；标题 settled 后匹配 `optimisticConversation.id` 覆盖其 `title`，Sidebar 订阅即异步刷新。轮询任务属于 store 模块生命周期，不随会话切换或组件重挂取消，查询异常也只在窗口内重试；唯一停止条件是标题 settled 或达到一分钟上限。现有 SSE `title_updated(title, conversationId)` 保留为兼容消费路径，但不能作为后台 worker 完成通知的唯一机制。历史会话收到兼容事件时，仍由上层 `hooks.onTitleUpdated` 的 `router.refresh()` 走 SSR 刷新。

> **Gotcha（Sidebar 合并）**：合并 SSR `conversations` 与乐观项时，若 SSR 已含同 id 会话，**不要整个 `return conversations` 忽略乐观项**。`createConversation` 的 `revalidatePath("/chat","layout")` 会让 SSR 很快带上新会话（此时 DB title 还是 `"新会话"`），而新会话场景跳过了 `router.refresh()`，SSR 不会自动追上 `maybeGenerateTitle` 写入的真实标题。必须用乐观项 title 覆盖 SSR 同 id 会话的 title，否则侧栏停在 `"新会话"`/旧值直到整页刷新。

> **Gotcha**：`usePathname()` **不会**跟随 `window.history.replaceState`（Next 路由状态与原生 history API 不同步）。凡用 `usePathname` 解析当前会话做高亮的 UI（如 `Sidebar`），在乐观建会期间不会立即更新，要等下一次真实路由导航。若需即时跟随，改用由 store 维护的 `activeConversationId` 驱动，而非 `usePathname`。

> **Gotcha（返回新对话）**：新会话建会后，地址虽经 `history.replaceState` 变成 `/chat/{id}`，Next 内部仍可能停在 `/chat`，而 `ChatComposer.activeConvId` 已切到真实 ID。此时再次导航到普通 `/chat` 会收到 200 RSC，但 React 会复用同一个 Composer，页面仍停在旧会话。Sidebar 的“新对话”必须导航到带唯一 `?new=<resetKey>` 的 URL，`chat/page.tsx` 再把该参数作为 `ChatComposer key` 强制重挂；只在 `hydrate(NEW_CONVERSATION_KEY)` 清 `activeConversationId` 不足以触发切换。重挂时仍只清活动指针，不得删除旧会话 runtime 或 `optimisticConversation`，后台流和尚未进入 SSR 列表的乐观项必须继续保留。测试至少覆盖 reset URL/key 映射，以及旧 runtime 仍为 `streaming` 且乐观项未丢失。

参考：`docs/cankao/DEEIX-Chat` 的 `use-chat-message-submit.ts` 用同款 `window.history.replaceState` 模式。

---

## Server State

- 读：Server Component 顶层 await service/action，结果序列化后传给 Client Component。
- 写：Server Action 完成后调用 `revalidatePath(path)` 让 Server Component 重取。
- DB 行类型是 `Record<string, unknown>`，传给 Client 前转成显式 DTO（见 type-safety）。

## Scenario: 设置活动草稿表单保留输入与提交状态

### 1. Scope / Trigger

- 修改 `/admin/settings` 中写入活动变更集的普通表单、治理表单、输出模式/样式弹窗、排序、删除确认、发布审查或历史回滚时，适用本节。

### 2. Signatures

- 普通表单：`useDraftAction(action: (formData: FormData) => Promise<void>)`，返回 `onSubmit`、`pending`、`idle | success | error`。
- 治理表单：`useActionState(saveGatewayGovernancePolicy.bind(null, expected), initialState)`；Action 返回 `idle | success | error`，不以异常作为字段校验反馈。
- 输出资源弹窗：`action(formData): void | Promise<void>`；删除确认使用可等待的 `onConfirm(): void | Promise<void>` 分支。
- 发布/回滚：`useActionState(action, initialState)` 返回 `idle | success | warning | error`，冲突作为可展示状态返回。
- 所有设置 Action 只 stage 服务端活动草稿并 `revalidatePath("/admin/settings")`；它们不表示生产配置已发布。

### 3. Contracts

- “保存”只表示变更已进入唯一活动草稿；界面必须使用“发布后生效”语义，不能显示成生产配置即时生效。
- 普通表单 `preventDefault()` 后必须立即复制 `new FormData(event.currentTarget)`，再在 transition 内调用 Action。失败时不调用 `reset()`、不关闭容器，保留用户输入。
- React 19 Action 可能 reset 原生表单。治理等使用 `<form action>` 的字段必须由 `value + useState + onChange` 控制；服务端草稿投影变化时，以包含完整 policy/value 的稳定 `key` 重建字段，使 DOM 与新服务端值收敛。
- pending 期间禁用当前表单的可变控件、提交、取消和重复确认。状态容器使用 `aria-live="polite"`；成功用 `role="status"`，失败用行内 `role="alert"`，不能只依赖 Toast。
- 输出模式/样式新增或编辑只有 Action 成功后才关闭弹窗并触发列表成功反馈；失败保留弹窗、当前输入和 unsaved 状态。关闭后才允许递增 form key 清理旧值。
- 排序可以乐观展示，但服务端失败必须恢复服务端顺序并显示错误。它与其他编辑共享同一草稿 expectation，过期版本不得静默覆盖。
- 设置页删除必须走 `ConfirmDialog.onConfirm` 的异步 pending/失败保留路径；在 `action` 分支具备同等语义前，不得用于这些删除操作。
- Action 从原生 `showModal()` 弹窗内提交时，pending 与成功/失败 live region 必须渲染在当前弹窗内；弹窗外控制面可以保留最终状态，但不能成为打开期间的唯一反馈，因为 dialog top layer 会使外层内容不可达。

### 4. Validation & Error Matrix

| 条件 | 预期行为 |
|---|---|
| 普通表单 stage 成功 | 保留/投影草稿值，显示成功状态；等待显式发布 |
| 普通表单 Action 抛错 | 保留输入，显示 `role=alert`，容器不关闭 |
| `useActionState` 返回字段错误 | 受控输入不回退，显示具体错误，允许修正后重试 |
| 草稿投影在 RSC 刷新后变化 | 相关 value key 变化，DOM/state 重建到新草稿值 |
| 新增/编辑输出资源成功 | 关闭弹窗并显示列表成功反馈 |
| 新增/编辑输出资源失败 | 弹窗、输入和 unsaved 状态保持可编辑 |
| 删除失败 | 确认框保持打开，显示行内错误，不重复提交 |
| 发布或回滚冲突 | 对应弹窗保持打开，并在弹窗内显示 `role=alert`；不得只更新弹窗外状态 |
| expectation 过期 | 显示失败/冲突；不覆盖新草稿版本 |
| 忘记 revalidate | 页面无法取得新草稿/version，属于契约违例 |

### 5. Good / Base / Bad Cases

- Good：UA 表单拦截原生提交并复制 FormData；stage 失败后两个输入仍是管理员刚输入的值。
- Good：治理输入受控，RSC 返回新草稿 policy 后通过 policy key 重建，成功与失败都有可访问反馈。
- Good：输出样式删除等待异步 `onConfirm`；失败时确认框保持打开，用户可重试或取消。
- Good：发布审查或历史回滚失败时，冲突文案出现在当前 Modal 内；关闭后控制面仍可保留结果。
- Base：保存与当前草稿相同的值，控件不跳动，仍显示明确结果。
- Bad：把 stage 成功文案写成“已即时生效”，会绕过显式发布的真实心智模型。
- Bad：使用原生 Action 后立即关闭/重置弹窗，失败时丢失输入且无法定位错误。
- Bad：Modal 内提交 Action，却只在 Modal 外更新状态；弹窗打开时用户看不到失败原因。

### 6. Tests Required

- Hook/组件测试覆盖 pending 锁定、成功状态、Action 抛错后的输入保留和 `role=alert`。
- `useActionState` 表单覆盖字段校验失败、React 原生 reset、服务端 policy key 变化和清空/自动值。
- 输出资源测试覆盖新增/编辑失败不关闭、成功才关闭、排序失败回退并显示错误。
- 删除确认测试覆盖异步 pending、失败保留弹窗、成功关闭，且设置页不得误走立即关闭的 `action` 分支。
- 发布/回滚组件测试覆盖冲突后 Modal 保持打开，且当前 dialog 内存在对应 `role=alert`。
- 浏览器验收断言提交前后的真实 `input/select.value`、焦点与弹窗可见性；lint/typecheck 不能替代 React form reset 的运行时检查。

### 7. Wrong vs Correct

```tsx
// Wrong：原生 Action/立即关闭会在失败时 reset 并丢失输入。
<form action={stageAction} onSubmit={closeDialog} />

// Correct：先捕获输入，失败保留；只有成功路径关闭。
const onSubmit = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  startTransition(async () => {
    try {
      await stageAction(formData);
      closeDialog();
    } catch {
      setFailed(true);
    }
  });
};
```

---

## Scenario: Chat SSE 终态与消息完整性

### 1. Scope / Trigger

修改内部 `/api/chat` SSE parser、send/regenerate/editAndResend/continueGeneration、停止生成或 `ChatMessage.status` 时适用。公开 `/v1/*` 不使用本契约。

### 2. Signatures

- `consumeChatSSE(body, handlers): Promise<ChatTerminalStatus>`。
- `ChatTerminalStatus = "success" | "failed" | "interrupted"`，唯一 owner 为 `src/lib/chat/sse-contract.ts`。
- `ChatMessage.status?: "success" | "interrupted"`；缺省只用于历史完整消息兼容。
- 内部正文撤回帧：`{ type: "content_retract"; text: string }`；对应 Core 事件为 `{ type: "text-retract"; text: string }`。

### 3. Contracts

- 内部成功 tail 固定为 `finish(metadata) -> terminal(success) -> [DONE]`；失败/中断为已有 error frame -> terminal(status) -> DONE。
- Parser 只在收到合法 DONE 时返回 terminal status。DONE 缺 terminal、success 缺 finish、矛盾/重复 terminal 或 EOF 缺 DONE 必须抛协议错误。
- 四条 Store 流式动作必须消费 parser 返回值：terminal success 写 message success；failed/interrupted 写 message interrupted；协议异常 catch 也写 interrupted。
- `stopGeneration` 在本地 Abort 时立即写 interrupted。取消后的 wire 写入由服务端抑制，不等待 terminal。
- `onError` 必须先 `flushDeltasNow()` 再向当前稳定 assistant index 追加一次错误。若 error frame 后又发生协议异常，catch 不得追加第二份错误。
- 模型在同一 step 先输出正文、随后调用工具时，Core 发送该 step 已输出正文的精确撤回后缀。Store 的 `onContentRetract` 必须先 `flushDeltasNow()`，再仅当当前正文以该文本结尾时删除后缀；不得清空整条消息。工具调用后的同 step 正文不再透传。
- `content_retract` 只影响当前生成 step 的新增正文。`continueGeneration` 必须保留续写前已有正文；普通无工具回答不发送撤回帧，继续逐 token 展示。
- Message status 表达“内容完整/可继续”，不是 run 失败分类。持久化 failed/interrupted assistant 均为 interrupted；`runs.status` 才是 success/failed/interrupted 的终态事实源。
- `ChatMessageItem` 仅当 assistant 有正文且 status=interrupted 时显示继续生成；success/缺省不显示。

### 4. Validation & Error Matrix

| Wire / action | Parser result | Store message status | Error text |
| --- | --- | --- | --- |
| finish, terminal(success), DONE | success | success | none |
| error, terminal(failed), DONE | failed | interrupted | exactly one |
| error, terminal(interrupted), DONE | interrupted | interrupted | exactly one |
| local Abort | AbortError | interrupted by stop | stopped marker |
| terminal/DONE contract violation | throw protocol error | interrupted | one existing or fallback error |
| content_retract matches current suffix | continue parsing | remove only that exact suffix after flushing pending deltas | none |
| content_retract does not match current suffix | continue parsing | keep content unchanged | none |

### 5. Good / Base / Bad Cases

- Good: regenerate receives a failed terminal after partial delta, keeps the partial text, appends one error, and marks the exact regenerated assistant interrupted.
- Good: a tool-call step briefly streams its search plan, then retracts only that suffix; the final answer and persisted assistant content contain only the grounded response.
- Base: continueGeneration receives success and changes the same assistant from interrupted to success, so the continue button disappears.
- Bad: parser returns void on bare EOF and continueGeneration unconditionally writes success.
- Bad: regenerate/edit catch uses the current last message instead of the assistant index captured for that request.
- Bad: handle `content_retract` by assigning `content = ""`; this deletes pre-existing content during continue generation.

### 6. Tests Required

- Parser tests cover chunked frames, final frame without newline, DONE without terminal, success without finish, contradictory/duplicate/invalid terminal, event after terminal, and EOF before DONE.
- Store table tests cover success/failed/interrupted plus protocol rejection for all four actions.
- Assert failed/interrupted retain content, write interrupted, and contain one error marker; success preserves finish metadata and writes success.
- Keep local Abort/stopGeneration and delta-before-error ordering regressions green.
- Retraction tests cover parser dispatch and send/regenerate/edit/continue Store paths, including pending
  delta flush, unmatched suffix no-op, persisted Core content, and preservation of continue-generation prefix.

### 7. Wrong vs Correct

```ts
// Wrong: transport close is not a business success signal.
await consumeChatSSE(body, handlers);
setMessageStatus("success");

// Correct: only the explicit terminal outcome can complete the message.
const terminal = await consumeChatSSE(body, handlers);
setCompletionStatusAt(key, assistantIdx, terminal);
```

```ts
// Wrong: pending rAF deltas can be appended again after the deletion.
removeSuffix(text);

// Correct: settle the buffer, then remove only the exact generated suffix.
flushDeltasNow();
removeSuffix(text);
```

续写仍把 interrupted assistant 正文作为 prefill。完整回答若允许续写会倾向复述，因此只有 interrupted 消息可继续生成。

---

## 流式 delta 合批与吐字节奏

流式增量经 `deltaBuffer` 合批:逐 token 的 delta 先累积,rAF 每帧最多 flush 一次,避免每 token `[...messages]` 整组替换 + setState 的高频重渲染。按 `${conversationKey}:${msgIdx}:${field}` 聚合,天然支持多会话并行。

**逐字 fadeIn 永久禁用**(`<Markdown>` 的 `animated={false}`)。A/B 实测 streamdown `animated:{animation:"fadeIn",sep:"char"}` 在弱硬件(60Hz)上 on 比 off 多 ~48% 掉帧、min FPS 更低,而 fadeIn 在正常/快 token 速率下肉眼本就不可见,性价比为负。打字感改由「store 逐帧增量 + 末尾光标(caret=block)」承担,不靠渲染器内部动画。

**正文限速**(`MAX_CONTENT_CHARS_PER_FRAME = 15`,~900 字/秒):`flushDeltas(force=false)` 时 content 字段每帧只追加前 15 字,剩余塞回 buffer 下一帧续放,使上游再快也保持逐帧节奏、不一坨一坨蹦。`reasoning` 不限速;`force=true`(`flushDeltasNow`)跳过限速一次性放完,避免流结束/中断末尾积压丢失。

**后台 tab 兜底**(`STREAM_FLUSH_FALLBACK_MS = 50`):tab 切后台时浏览器暂停/降频 rAF,纯靠 rAF 流式会卡死。`enqueueDelta` 与续帧处双调度 rAF + setTimeout(50ms),先到先 flush、另一个 cancel;前台 rAF(~16ms)总先到,兜底基本不触发;后台 setTimeout(降频到 ~1s)接管缓慢推进。`flushDeltasNow` 同步执行不依赖定时器,后台流结束也能立即放完。

```ts
// 双调度:rAF 主路径,setTimeout 兜底后台 tab
deltaFlushRaf = requestAnimationFrame(() => flushDeltas());
deltaFlushTimeout = window.setTimeout(() => flushDeltas(), STREAM_FLUSH_FALLBACK_MS);
```

---

## Common Mistakes

- **`requestAnimationFrame(flushDeltas)` 直接传函数引用** -> rAF 把时间戳作为首参传入,若 `flushDeltas(force = false)` 有默认参数,时间戳(truthy)会被当 `force=true`,限速静默失效。必须箭头包裹 `() => flushDeltas()`;setTimeout 兜底回调同理。
- **错误/停止标记直接 `set` 追加 content,绕过 `deltaBuffer`** -> `catch`/`onError` 里直接 set 写标记,会赶在 `finally` 的 `flushDeltasNow` 残留正文之前,标记夹在限速正文中间(`onError` 用覆盖还会丢已生成正文)。必须先 `flushDeltasNow()` 落库缓冲正文,再用 `appendContentAt` 追加标记,保证"正文在前、标记在后";四个流式动作(send/regenerate/editAndResend/continueGeneration)统一如此。
- **在完整回答上允许续写** → prefill 是已结束的整段文本，模型续写时复述原文、内容雷同。续写按钮必须仅 `status === "interrupted"` 时渲染。
- **后端 status 用「有没有输出文本」判定** → 中断但已生成部分内容的消息被误判 success，刷新会话后前端丢 interrupted 标记、续写按钮消失。必须用「是否收到 finish 事件」判定。
- **selector 里返回新对象/数组字面量** → zustand 判定引用变化，触发无限渲染。改用 `useShallow` + 模块级常量兜底。
- **把流式状态放进组件本地 state** → 切路由组件卸载，流式中断。必须进全局 store。
- **在 store 里存不可序列化的 server-only 对象** → store 是 client 域，只能存纯数据 + `AbortController` 这类浏览器对象。
- **忘记 `revalidatePath`** → Server Action 写库后页面不刷新。
- **乐观创建资源后用 `router.replace` 同步 URL** → 触发 RSC 重载 + 组件重挂，新会话发消息时闪欢迎态、打断流式。改用 `window.history.replaceState` 静默换 URL，配合组件持有可变活动 id 切订阅 key（见上「乐观创建资源后的 URL 同步」）。
- **新会话侧栏标题不刷新** → 标题 worker 只写数据库，聊天 SSE 已关闭后没有跨进程推送；若前端只等待 `title_updated`，乐观标题会停在截断值直到整页刷新。新会话请求被接受后必须启动按 `conversationId` 隔离的有界短轮询，并仅在 ID 匹配时更新 `optimisticConversation.title`；SSE 标题事件只作为兼容路径（见「乐观创建资源后的 URL 同步 · 乐观项标题的异步刷新」）。

## Scenario: 聊天附件消费边界

### 1. Scope / Trigger

修改 `useChatAttachments`、`useChatRuntime` 或 `chatStreamStore.send` 的附件发送状态时，必须保证附件只属于用户明确发送的当前一轮，同时保留未被服务器接受或未上传成功的项。

### 2. Signatures

- `ChatMessageAttachment = { fileId: string; filename: string; mime: string }`。
- `uploadAttachments(conversationId): Promise<ChatMessageAttachment[]>` 返回完整、有序的本轮消息附件；任一上传失败时 reject，不返回成功子集。
- `onAttachmentsConsumed(fileIds: string[]): void` 表示 `/api/chat` 已接受这些 fileIds。
- `clearConsumedAttachments(fileIds)` 只清理本轮已消费的 uploaded 项。

### 3. Contracts

- `chatStreamStore.send` 在 `response.ok && response.body` 之后、`consumeChatSSE` 之前调用一次 `onAttachmentsConsumed(fileIds)`。
- 乐观 user/assistant 只能在全部附件上传成功后追加；上传失败时不调用 `/api/chat`，新会话允许只留下为上传归属而创建的空会话。
- 乐观 user 消息保存同一批附件 DTO；空文字但附件非空可以发送，二者都为空才禁止。
- 非 2xx、无 body、fetch 或上传失败时不得调用；响应已接受后的 SSE 中断不恢复附件。
- 回调必须携带本轮 fileIds，不能无参清空全部 uploaded 项，否则请求等待期间并发新增的附件会被误删。
- 附件 hook 使用 functional update，仅移除 `status === "uploaded"` 且 fileId 位于参数集合中的项；保留 pending/uploading/error 和其他 uploaded 项。
- 被移除项有 preview URL 时同步 `URL.revokeObjectURL`。

### 4. Validation & Error Matrix

| 时机 | 消费回调 | 附件状态 |
| --- | --- | --- |
| 任一上传失败 | 不调用且不请求 `/api/chat` | 全部保留，不创建乐观消息 |
| HTTP 非成功 / 无 body | 不调用 | 全部保留 |
| HTTP 成功且有流 body | 本轮 fileIds 调用一次 | 仅清本轮 uploaded |
| 后续 SSE 中断 | 已调用，不恢复 | 新增/失败项仍保留 |

### 5. Good / Base / Bad Cases

- Good：本轮 `file-1` 被接受，等待期间新增的 `file-2` 继续留在 Composer。
- Good：仅图片消息的乐观 user 保存 `content: ""` 和同一附件 DTO。
- Base：纯文本消息保持原发送路径，不产生附件 DTO。
- Bad：从不清理 uploaded 项会让每条后续消息重复携带旧 fileIds；成功后无参 reset 又会误删并发新增或失败项。

### 6. Tests Required

- Store 单测断言成功 response 的 request body fileIds 与消费回调参数一致，且回调先于 SSE 消费。
- Store 单测断言任一上传失败时没有乐观消息和 chat 请求；仅图片消息同时写入 DTO 与请求 fileIds。
- 非成功 response 不调用消费回调。
- 成功 response 后 SSE 失败仍只调用一次消费回调。
- lint/typecheck 必须证明 Composer -> runtime hook -> store 的带参回调完整透传。

### 7. Wrong vs Correct

```typescript
// Wrong:旧附件永远保留，或成功时把所有附件一刀切清空。
const fileIds = await uploadAttachments(conversationId);
await fetch("/api/chat", request);
resetAttachments();

// Correct:服务器接受后只消费本轮 fileIds。
const attachments = await uploadAttachments(conversationId);
const fileIds = attachments.map((attachment) => attachment.fileId);
const response = await fetch("/api/chat", request);
if (!response.ok || !response.body) throw new Error("请求失败");
onAttachmentsConsumed?.(fileIds);
await consumeChatSSE(response.body, handlers);
```
