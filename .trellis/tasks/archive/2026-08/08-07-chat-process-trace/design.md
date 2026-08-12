# 统一聊天过程轨迹：技术设计

## 1. Architecture

采用一条跨层事件链，不引入第二套聊天运行系统：

```text
HTTP preflight
  -> run coordinator + trace recorder
  -> prepareChatContext instrumentation
  -> provider/tool/search domain events
  -> versioned ChatProcessEvent SSE
  -> one frontend reducer
  -> MessageProcessTrace
  -> final ChatProcessSnapshot in messages.processTrace
  -> history uses the same reducer/projection
```

职责边界：

- `@nekusora/contracts`：事件、步骤、阶段、状态和快照的唯一类型来源。
- Core trace recorder：唯一 `seq` 分配者，维护步骤状态并生成最终快照。
- Orchestrator/coordinator：报告领域事实，不生成 UI 文案。
- Route：只序列化协议和映射最终 terminal，不拼业务状态。
- SSE parser：从 `unknown` 做一次解码/校验。
- Zustand store：唯一实时 reducer 和消息投影边界。
- Component：只渲染 reducer 结果，局部只保存 disclosure 的用户交互状态。
- History action：返回已持久化快照；旧数据走同一个兼容投影。

## 2. Contract V1

在 `packages/contracts/src/chat.ts` 增加版本化契约。建议形状：

```ts
type ChatProcessPhase =
  | "preparing"
  | "processing"
  | "answering"
  | "completed"
  | "failed"
  | "interrupted";

type ChatProcessStepStatus =
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "interrupted";

type ChatProcessStepKind =
  | "attachments"
  | "memory"
  | "compaction"
  | "rag"
  | "prompt"
  | "reasoning"
  | "tool"
  | "web_search"
  | "sources";

interface ChatProcessStep {
  id: string;
  kind: ChatProcessStepKind;
  status: ChatProcessStepStatus;
  startedAt?: string;
  endedAt?: string;
  data?: ChatProcessSafeData;
}

interface ChatProcessEvent {
  type: "trace";
  version: 1;
  runId: string;
  seq: number;
  phase: ChatProcessPhase;
  step?: ChatProcessStep;
}

interface ChatProcessRunSnapshot {
  runId: string;
  phase: Exclude<ChatProcessPhase, "preparing" | "processing" | "answering">;
  steps: ChatProcessStep[];
  startedAt: string;
  firstContentAt?: string;
  endedAt?: string;
}

interface ChatProcessSnapshot {
  version: 1;
  runs: ChatProcessRunSnapshot[];
}
```

`ChatProcessSafeData` 使用按 `kind` 区分的联合类型，只允许：

- 附件数量和处理模式；不含文件内容。
- 记忆来源/命中数量；不含记忆原文。
- 压缩策略、原始/发送消息数；不含摘要文本。
- RAG 文件数、命中数、fallback reason code；不含检索片段。
- Prompt 消息数和 token 估算；不含 Prompt 文本。
- 工具 ID、显示名和状态；不复制任意 args/result。
- Web Search 的现有安全 backend、attempt outcome、citation count；详细 citations 继续由既有结构承载。
- 错误只用枚举 reason code；不存 raw error。

后端不发送本地化 title/summary。前端按 `kind/status/reasonCode` 使用 next-intl 映射，避免历史消息跟随生成时语言永久固化。

## 3. Backend Flow

### 3.1 Preflight boundary

SSE 建立前继续完成：

1. session、请求 schema、会话属主和 composer snapshot。
2. branch/parent/source/continue 关系。
3. 附件属主、fileIds 使用规则、静态图片识别和 vision capability。
4. 普通 send 的 user 消息/附件事务及稳定 publicId。

这些步骤涉及外部输入或必须保留精确 HTTP 状态，不放进流内。

### 3.2 Run-owned preparation

扩展现有 coordinator，使单个 run 同时拥有准备、模型调用和完成持久化：

1. `startRunStrict` 成功并启动 heartbeat。
2. 发送 user/assistant identity 和 `phase=preparing`。
3. 在流内调用带 recorder 的 `prepareChatContext`。
4. recorder 为阶段 2 的并行分支预先创建稳定 stepId；各分支独立发 running/terminal 状态。
5. 所有必需准备完成后，发送 Prompt 规划完成和 `phase=processing`。
6. 初始化 MCP、Web Search、UA 并进入现有 `streamChat/streamChatWithTools`。
7. 第一个非空 `text-delta` 前，recorder 完成当前 reasoning step，记录 `firstContentAt`，先发 `phase=answering`，再发正文。
8. 现有 terminal latch、iterator settlement、heartbeat stop 和完成事务保持唯一所有者。

coordinator 接收惰性的 `prepare(signal, recorder)`，成功后返回当前的 prepared request、trace、tool/search capability 和 compaction 结果；route 不再提前构造这些生成输入。这样 run start、准备、模型调用和终态仍只有一个所有者。

`startRunStrict` 失败：保持现有行为，不调用 prepare/模型、不伪造可持久 assistant/trace，只让 optimistic UI 收敛为通用启动错误。prepare 硬失败：不调用模型，record failed step，走已有 failed completion/terminal 路径并保存安全快照。Abort during prepare：标记 interrupted，不继续启动模型。

所有目前可能从 `prepareChatContext` 返回精确 4xx 的用户输入/能力校验必须移入 preflight；run-owned prepare 只返回 typed internal/degraded outcome，不能在响应头发送后再尝试返回 `Response`。

### 3.3 Instrumentation without serialization

保持当前 `Promise.all`：附件/RAG、记忆、压缩、output mode、模板、指令卡仍并行。事件顺序代表实际完成顺序，不代表执行依赖顺序；UI 通过 `stepId` 更新原步骤，通过首次 running 的 seq 决定稳定排列。

模板、指令卡和 output mode 在用户界面归入 `prompt`，不暴露内部产品结构。可降级错误发 `skipped`，硬错误发 `failed`。

### 3.4 Existing domain events

- reasoning delta 仍走已有 `reasoning` 事件，trace 只发送 reasoning step 的开始/完成，不重复每 token。
- tool/search 现有事件继续用于工具记录、搜索来源和兼容客户端。
- recorder 观察同一 domain event 生成过程 step，不能由 route 和 store分别猜测。
- `toolCallId` 是工具/搜索步骤稳定 ID；缺失 ID 只保留既有 legacy fallback。
- 顶层 phase 单向前进：`preparing -> processing -> answering -> terminal`。第一次进入 `answering` 后，即使出现后续 reasoning/tool/search step 也不回退 phase。

## 4. Persistence And History

扩展现有 `ProcessTrace`：

```ts
interface ProcessTrace {
  // existing blocks, counts, webSearch, fingerprint...
  process?: ChatProcessSnapshot;
}
```

JSONB 增加字段不需要数据库迁移。快照在现有 assistant/run 完成事务中一次写入：

- success：`completed`。
- provider/prepare/persistence 前错误：`failed`；若完成事务自身失败，以 runs/日志为事实，不伪造历史成功。
- Abort/EOF：`interrupted`。
- continue：读取原快照并追加新的 `ChatProcessRunSnapshot`；每个 run 独立分配 seq/stepId，UI 再按 run/step 首次时间展平。Web Search calls 继续沿用现有 additive 规则。

不高频更新 `messages.processTrace`，不创建通用事件表。当前产品在客户端断开时会中止生成，因此“断线后继续订阅”没有可靠业务事实可恢复；只有未来改为后台生成时，才设计 Redis Stream/事件日志和 `afterSeq`。

## 5. Frontend State

### 5.1 One reducer

新增纯函数 `reduceChatProcess(state, event)`：

- exhaustive `switch` 处理 phase 和 step 状态。
- 拒绝不同 runId；忽略 `seq <= lastSeq`。
- step 按 id upsert，首次出现的位置不因后续更新改变。
- terminal 后拒绝业务更新，与 SSE terminal 契约一致。
- 同一 reducer 用于 live events 和 snapshot/history normalization。

`lastSeq` 按 runId 保存，不是 message 全局单值。step 的身份为 `(runId, stepId)`，避免 continuation 的固定步骤名互相覆盖。

`ConversationRuntime` 保存活动 assistant 的 process state；`ChatMessage.processTrace` 保存可序列化快照。不要把 Accordion 展开状态、DOM ref 或 timer 写入 store/DB。

### 5.2 Compatibility

- 新客户端 + 新服务端：使用 trace event 和 snapshot。
- 新客户端 + 旧历史：从 reasoning/toolCalls/searchResults 构建 `completed/interrupted` 只读步骤。
- 旧客户端 + 新服务端：忽略未知 `trace`，继续消费原事件。
- 分支/版本切换：使用目标 assistant 自己的 runId/processTrace/toolCalls/search data 全量替换。

### 5.3 Optimistic feedback

用户点击发送后，store 立即为 optimistic assistant 设置 `preparing`，文案仅表示请求正在准备，不伪造具体步骤。收到服务端 trace 后以 runId 接管；HTTP preflight 失败则移除/标记失败并显示现有错误。

## 6. Interaction Design

### 6.1 Layout

- assistant 正文前只有一个过程 disclosure。
- 外层默认只显示当前动作或 44-48px 的终态摘要；完整内容使用无逐行分隔线的轻量时间线，不嵌套卡片、不加静态投影。
- 组件内通过纯语义投影把 raw steps/tool calls 归并为 `understand/context/reasoning/search/read`；进入 `answering` 时立即切换完成摘要，并使用 `firstContentAt` 截止研究耗时，正文流式期间不再变化，也不重复展示答案生成阶段。组件不直接渲染内部 kind、工具名、参数、provider 路径或 reasoning 正文。
- 来源位于时间线下方的独立 disclosure；标题、域名和可用摘要保持 48-64px 的轻量行，不作为步骤或完成计数。
- 过程 snapshot 只负责步骤状态；reasoning 文本、工具详情和 citations 继续从消息既有字段按 runId/toolCallId 连接，不在 snapshot 复制内容。

### 6.2 Auto behavior

- 新 run 默认折叠完整时间线，运行摘要随当前语义阶段更新。
- run 从 active 进入 completed/failed/interrupted 时自动收起一次；终态后用户可重新展开。
- 正文开始后的工具/搜索更新只更新摘要，不强制重新展开。
- partial search failure 只用小型 warning icon 和局部说明，不把整块染红。

### 6.3 Copy

摘要示例：

- `正在准备上下文`
- `正在检索资料`
- `正在使用 2 个工具`
- `已完成 6 个步骤 · 8 秒`
- `处理未完成 · 已保留 3 个步骤`

不显示“模型正在读取你的记忆原文”等容易造成隐私误解的文案；用“已匹配相关记忆”及数量表达。

### 6.4 Accessibility and motion

- 原生 `details/summary` 或等价 button disclosure，完整 focus-visible。
- `aria-live=polite` 只放简短 phase 摘要；步骤列表、reasoning 和正文不 live。
- 图标 `aria-hidden`，状态有可读文本；错误不能只用红色。
- 动效限于 150-250ms 的 opacity/transform/status transition；全局 reduced-motion 生效。
- coarse pointer 使用 `touch-target`；长 query、URL、tool name 必须 wrap/truncate，不扩大固定几何。

## 7. Failure Matrix

| 条件 | 轨迹 | 模型 | 终态/UI |
| --- | --- | --- | --- |
| HTTP preflight 失败 | 无虚假步骤 | 不调用 | 现有 HTTP 错误 |
| strict run start 失败 | 无持久 trace | 不调用 prepare/模型 | optimistic 状态收敛为通用失败 |
| 可降级记忆/RAG失败 | step skipped/安全原因 | 继续 | 可展开查看降级 |
| prepare 硬失败 | failed snapshot | 不调用 | error + terminal(failed) |
| Abort during prepare | interrupted snapshot | 不调用 | 保留步骤/停止生成 |
| reasoning/tool/search 后失败 | 保留已发生步骤 | 不切已提交路由 | failed/partial content |
| 首正文后 Abort | phase interrupted | 停止上游 | 保留正文和轨迹 |
| trace emit/record 失败 | 内部告警，禁 raw data | 回答继续 | 回退旧 UI 投影 |
| 旧消息无 snapshot | 派生只读兼容轨迹 | 不适用 | 不显示 running |

## 8. Rollout And Rollback

按契约兼容顺序提交：共享类型/reducer测试 -> 后端 additive trace -> 快照历史 -> 新 UI -> 移除旧独立展示。每一步保持旧事件可用。

回滚时可以先禁用新 UI 使用兼容投影，再回滚后端 trace emission；`processTrace.process` 是可忽略 JSONB 字段，不影响旧代码。不要长期维护两套 coordinator 主路径或双写事件表。

运行指标只记录低基数、安全字段：time-to-first-trace、prepare duration、first-content latency、trace event count、emit failure count 和 terminal status。不得记录步骤 data、query、URL、Prompt、memory、tool payload 或 raw error。

## 9. Deferred Upgrade Trigger

只有产品明确要求“刷新/关页后生成继续”时，另立后台运行任务，重新定义：请求与生成解耦、事件 broker、持久游标、订阅授权、TTL、租约接管、重放窗口和计费语义。届时 `runId/seq/stepId` 可直接复用，但本任务不预埋不可验证的 Redis/DAG 代码。
