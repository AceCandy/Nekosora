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

**乐观项标题的异步刷新**：新会话乐观项的初始标题是首条消息截断（store 内 `titleFrom`），后端 `/api/chat` 会通过 SSE 推 `title_updated` 帧（fallback + LLM 摘要各一次，帧里带 `title` 和 `conversationId`）。由于新会话场景刻意跳过了 `router.refresh()`（避免跨 segment 重挂），标题刷新必须走 store：在 SSE 回调里接住 `(title, conversationId)`，匹配 `optimisticConversation.id` 后覆盖其 `title`，Sidebar 订阅即异步刷新。**不要在中间层把带参回调降级成无参**（如 `onTitleUpdated: () => hooks?.onTitleUpdated?.()`）——那样会丢掉 SSE 推过来的 title，侧栏会一直停在截断标题、直到下次整页刷新。历史会话无乐观项，仍由上层 `hooks.onTitleUpdated` 的 `router.refresh()` 走 SSR 刷新。

> **Gotcha（Sidebar 合并）**：合并 SSR `conversations` 与乐观项时，若 SSR 已含同 id 会话，**不要整个 `return conversations` 忽略乐观项**。`createConversation` 的 `revalidatePath("/chat","layout")` 会让 SSR 很快带上新会话（此时 DB title 还是 `"新会话"`），而新会话场景跳过了 `router.refresh()`，SSR 不会自动追上 `maybeGenerateTitle` 写入的真实标题。必须用乐观项 title 覆盖 SSR 同 id 会话的 title，否则侧栏停在 `"新会话"`/旧值直到整页刷新。

> **Gotcha**：`usePathname()` **不会**跟随 `window.history.replaceState`（Next 路由状态与原生 history API 不同步）。凡用 `usePathname` 解析当前会话做高亮的 UI（如 `Sidebar`），在乐观建会期间不会立即更新，要等下一次真实路由导航。若需即时跟随，改用由 store 维护的 `activeConversationId` 驱动，而非 `usePathname`。

参考：`docs/cankao/DEEIX-Chat` 的 `use-chat-message-submit.ts` 用同款 `window.history.replaceState` 模式。

---

## Server State

- 读：Server Component 顶层 await service/action，结果序列化后传给 Client Component。
- 写：Server Action 完成后调用 `revalidatePath(path)` 让 Server Component 重取。
- DB 行类型是 `Record<string, unknown>`，传给 Client 前转成显式 DTO（见 type-safety）。

## Scenario: Server Action 配置表单保存后保持当前值

### 1. Scope / Trigger

- 使用 React 19 `<form action={serverAction}>` 保存配置，且提交成功后选择器或输入值必须留在最新服务端值时，适用本节。

### 2. Signatures

- Server Action：`(formData: FormData) => Promise<void>`，写入后调用 `revalidatePath(containerPath)`。
- Client 表单接收 `initialValue`、Server Action 与候选项；Server Component 以已保存值组成 React `key`。

### 3. Contracts

- React 19 在 Action 成功后会 reset 原生表单；`defaultValue` 只定义挂载默认值，不能负责保存后的 current value。
- 需要留值的选择器使用 `value + useState + onChange` 维持提交期间交互状态。
- 仅受控值仍不够：原生 reset 可直接改 DOM，state 未变化时 React 不会再次写回。Action 必须写库并 revalidate，Server Component 用新已保存值改变 Client 表单 `key`，重建 DOM/state 后收敛。
- 清空配置也必须改变 key（例如 `task:${savedId}`，空值仍参与字符串），确保自动模式正确重建。

### 4. Validation & Error Matrix

| 条件 | 预期行为 |
|---|---|
| 保存不同值成功 | revalidate 返回新值，key 变化，控件保持新值 |
| 清空成功 | key 变化到空值，控件保持自动/空状态 |
| 保存相同值成功 | reset 回到相同已保存值，无视觉回退 |
| Action 失败 | 不把失败值伪装成已保存；错误交给现有 Action 边界处理 |
| 忘记 revalidate | RSC 不返回新已保存值，key 不变化，属于契约违例 |

### 5. Good / Base / Bad Cases

- Good：Client 受控选择器 + Server Action 写库/revalidate + 服务端已保存值 key。
- Base：保存当前已有值，提交前后显示不变。
- Bad：只给 Server Component `<select>` 写 `defaultValue`，Action reset 后回旧值，整页刷新才正确。
- Bad：只改成受控选择器但 key 恒定；reset 直接改 DOM 后可能仍显示旧值。

### 6. Tests Required

- 浏览器集成至少覆盖：选择另一个值并保存、清空为自动并保存、随后刷新仍一致。
- 断言提交前后的 DOM `select.value`，不能只断言数据库或 Server Action 返回成功。
- lint/typecheck 只能验证边界类型，不能替代 React form reset 的运行时检查。

### 7. Wrong vs Correct

```tsx
// Wrong：revalidate 虽正确，但非受控 current value 会被 Action reset。
<select name="model_id" defaultValue={savedModelId} />

// Correct：客户端维持交互值，服务端新值通过 key 强制重新收敛。
<ModelConfigForm
  key={`model:${savedModelId}`}
  initialModelId={savedModelId}
  action={saveModel}
/>
```

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
- **新会话侧栏标题不刷新** → SSE `title_updated` 帧带了 `title`，但 store 层回调签名写成无参 `() => void` 把 title 丢了；又因新会话跳过 `router.refresh()`，侧栏停在截断标题直到整页刷新。store 回调必须接住 `(title, conversationId)` 并更新 `optimisticConversation.title`（见「乐观创建资源后的 URL 同步 · 乐观项标题的异步刷新」）。

## Scenario: 聊天附件消费边界

### 1. Scope / Trigger

修改 `useChatAttachments`、`useChatRuntime` 或 `chatStreamStore.send` 的附件发送状态时，必须保证附件只属于用户明确发送的当前一轮，同时保留未被服务器接受或未上传成功的项。

### 2. Signatures

- `uploadAttachments(conversationId): Promise<string[]>` 返回本轮请求携带的 fileIds。
- `onAttachmentsConsumed(fileIds: string[]): void` 表示 `/api/chat` 已接受这些 fileIds。
- `clearConsumedAttachments(fileIds)` 只清理本轮已消费的 uploaded 项。

### 3. Contracts

- `chatStreamStore.send` 在 `response.ok && response.body` 之后、`consumeChatSSE` 之前调用一次 `onAttachmentsConsumed(fileIds)`。
- 非 2xx、无 body、fetch 或上传失败时不得调用；响应已接受后的 SSE 中断不恢复附件。
- 回调必须携带本轮 fileIds，不能无参清空全部 uploaded 项，否则请求等待期间并发新增的附件会被误删。
- 附件 hook 使用 functional update，仅移除 `status === "uploaded"` 且 fileId 位于参数集合中的项；保留 pending/uploading/error 和其他 uploaded 项。
- 被移除项有 preview URL 时同步 `URL.revokeObjectURL`。

### 4. Validation & Error Matrix

| 时机 | 消费回调 | 附件状态 |
| --- | --- | --- |
| 上传或 fetch 失败 | 不调用 | 全部保留 |
| HTTP 非成功 / 无 body | 不调用 | 全部保留 |
| HTTP 成功且有流 body | 本轮 fileIds 调用一次 | 仅清本轮 uploaded |
| 后续 SSE 中断 | 已调用，不恢复 | 新增/失败项仍保留 |

### 5. Good / Base / Bad Cases

- Good：本轮 `file-1` 被接受，等待期间新增的 `file-2` 继续留在 Composer。
- Base：无附件消息回调空 fileIds，不改变附件 state。
- Bad：从不清理 uploaded 项会让每条后续消息重复携带旧 fileIds；成功后无参 reset 又会误删并发新增或失败项。

### 6. Tests Required

- Store 单测断言成功 response 的 request body fileIds 与消费回调参数一致，且回调先于 SSE 消费。
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
const fileIds = await uploadAttachments(conversationId);
const response = await fetch("/api/chat", request);
if (!response.ok || !response.body) throw new Error("请求失败");
onAttachmentsConsumed?.(fileIds);
await consumeChatSSE(response.body, handlers);
```
