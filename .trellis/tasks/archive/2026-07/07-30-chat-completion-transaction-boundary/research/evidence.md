# Chat Completion Transaction Boundary Evidence

## Scope

本研究记录第一个架构深化 child 的现状证据、可复用契约和规划取舍。只描述 WebChat completion；Gateway retry/failover、RAG 与通用 worker lifecycle 不在此处重建。

## Route Control Flow

- `src/app/api/chat/route.ts:233-405`：生成 runId、写/复用 user、title outbox、准备上下文、best-effort startRun。
- `src/app/api/chat/route.ts:413-570`：AbortController、heartbeat、ReadableStream、plain/Agent stream 选择、事件 fold 与 SSE。
- `src/app/api/chat/route.ts:571-645`：conversation 行锁事务、parent/source 复核、assistant insert 或 continue CAS。
- `src/app/api/chat/route.ts:647-700`：artifact、conversation 时间和直接 memory queue send。
- `src/app/api/chat/route.ts:703-755`：completion metadata、best-effort finalizeRun、finish 与 `[DONE]`。
- `src/app/api/chat/route.test.ts:229-945` 已覆盖引用/CAS、必要持久化失败无 DONE、heartbeat 单飞与停止、run start false、request abort、reader cancel 和 bounded fallback；缺少 strict finalize DB failure、完整 event mapping、Agent route、memory recovery 与 terminal race matrix。

## Database And Locking

- `src/lib/chat/message-reference.ts:5-32`：`withConversationMessageWrite` 在 transaction 中先锁 authorized conversation，再执行消息写。
- `src/db/schema/pg.ts:363-392`：messages.runId 是普通 text，无 runs FK；message publicId 唯一。
- `src/db/schema/pg.ts:420-446`：runs.runId 唯一，status 为 text，running lease 有部分索引。
- `src/db/schema/pg.ts:448-461`：tool_calls.runId FK 到 runs，toolCallId 当前无唯一约束。
- `src/lib/chat/run-lifecycle.ts:175-247`：start/finalize 各自使用 5 秒 best-effort；finalize 只按 runId + running 更新且不检查 affected row。
- PostgreSQL/Drizzle 支持把 message、conversation、intent 和 run update 放入同一 callback transaction。模型调用不能进入该事务。

## Existing Durable Outbox Pattern

- `src/db/schema/pg.ts:332-354`：`conversation_title_jobs` 以 conversation unique、随机 job id fencing、dispatchAfter index 建模。
- `src/lib/conversation-title/service.ts:76-109`：fallback 与 outbox 同事务；outbox 失败回滚 fallback。
- `src/lib/conversation-title/dispatch.ts:12-81`：条件 claim 后 queue send；send 不删除 row；60 秒单飞 recovery、limit 25、逐项隔离。
- `src/lib/conversation-title/service.ts:208-253`：worker conversation-first lock、双重 job id 检查、成功/no-op 删除、失败保留。
- 可复用的是 durability/claim/fencing/recovery 原则，不是把不同领域强行放进同一表。

## Memory Failure Chain

- `src/app/api/chat/route.ts:683-700`：memory queue send 不在消息事务内，失败只 console。
- `src/worker.ts:44-53`：worker 直接 await `extractMemories`。
- `src/lib/memory/extract.ts:25-56`：频率保护和消息不足是 no-op；getMemory/memory.add failure 被 catch 后返回；cacheSet/invalidate 也被忽略。
- 结果：queue 不可用/进程退出会丢 job，核心抽取失败又会被 pg-boss 误认为成功。durable intent 必须同时解决 producer gap 与 failure/no-op 可区分性。

## SSE And Client Behavior

- `src/features/chat/model/sse.ts:74-129`：`[DONE]` 立即结束；error 后仍继续；EOF 无 `[DONE]` 也自然 resolve；重复 finish 无去重。
- `src/features/chat/store/chatStreamStore.ts:510-571`：error 追加到 assistant，AbortError 追加停止标记，finally 清 streaming。
- `src/features/chat/store/chatStreamStore.ts:904-919`：用户停止时立即 abort 并把最后 assistant 标为 interrupted。
- `src/app/api/chat/route.ts:742-755` 当前只检查 message-side `completionPersisted`，无法观察 finalizeRun 内真实 DB 失败。
- 新边界无需新增 SSE 字段，但必须把 finish/DONE 语义收紧为 committed success，并在非取消失败 EOF 前发送现有 error frame。

## Agent Usage

- `src/lib/stream.ts:437-583`：Agent loop 所有 step 共享 agentRunId；中间 finish 不外发；整个 loop 最多一个最终 finish。
- `src/lib/stream.ts:451-455,676-683`：gateway telemetry 已累加所有 step usage。
- `src/lib/stream.ts:521-532`：最终向 route yield 原始 `stepFinish`，其 usage 只有最后一步。run metadata 需要改为 aggregateUsage，但不得额外 finalize gateway execution。

## Applicable Specs

- `.trellis/spec/backend/database-guidelines.md`：PostgreSQL transaction、conversation title durable outbox、migration/journal/snapshot 与 worker failure propagation。
- `.trellis/spec/backend/chat-run-metadata.md`：runs 唯一 metadata 事实源、finish/DONE 顺序与历史投影。
- `.trellis/spec/backend/logging-guidelines.md`：run lease、heartbeat、Agent runId、取消和终态矩阵；其中 start/finalize best-effort success 语义将由本任务更新。
- `.trellis/spec/backend/error-handling.md`：cancel 后零 controller 写和 provider error redaction。
- `.trellis/spec/backend/gateway-routing.md`：Gateway execution engine 独占 retry/failover/commit；Agent loop 在 engine 外但只 finalize 一个 execution。

## Decisions And Rejected Alternatives

### Chosen: Strict Start + Atomic Completion

可靠 run 是 tool audit FK 和成功 metadata 的前提。允许 start 失败后继续生成只能保留不可证明的回答，因此选择 DB 失败时不调用上游。必要消息、conversation time、memory intent 与 run terminal 进入同一短事务。

### Rejected: Keep Finalize Best-effort And Add Another Boolean

调用方仍无法证明 DB row 已终结，只会继续堆叠进程内状态；不能满足 `[DONE]` 可靠性。

### Chosen: Dedicated Memory Intent

当前只有 memory 缺 durable producer boundary，title 已有不同的业务 fencing。专用表提供最小可执行机制，避免无真实第二消费者支撑的通用 event bus。

### Rejected: Delete Outbox On Queue Acceptance

pg-boss acceptance 不能证明 memory provider/add 已完成；worker 当前还会吞失败。row 必须保留到业务成功或明确 no-op。

### Chosen: At-least-once, Not Exactly-once

PostgreSQL 与外部 mem0 之间没有共同事务或已确认的 idempotency API。承诺 exactly-once 不真实；本任务采用 durable row、claim/fencing、failure propagation 和 mem0 现有 dedupe。

### Rejected: Put Artifact In Core Transaction

artifact 是可重建派生数据。把它提升为 success gate 会让解析/派生表异常回滚用户消息，不符合核心目标。

## Remaining Known Risks

- 外部 mem0 成功后、intent delete 前进程退出会重放；exactly-once 需供应商 idempotency 或独立消费者状态机，当前不承诺。
- strict DB start 降低数据库异常时的模型可用性，这是为核心一致性主动接受的取舍。
- Web/worker payload 同步切换需要协调部署；最终不保留长期双协议。
- 事务异常时数据库本身不可用，失败 run 可能保持 running 到租约过期；这不会产生 success signal，后续可由 Worker/queue/recovery 任务考虑终态物化。
