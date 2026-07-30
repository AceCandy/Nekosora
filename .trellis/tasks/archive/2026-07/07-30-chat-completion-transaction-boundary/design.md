# Chat Completion Transaction Boundary Design

## 1. Design Intent

问题不是 route 文件过长本身，而是“用户可见成功”没有单一事实源。当前消息事务、run best-effort finalize、memory fire-and-forget 和 SSE terminal 由独立步骤共同决定，任一进程退出或吞错都可能让成功信号领先于可靠业务事实。

目标边界是一个 completion coordinator：模型流只产生事件与权威 outcome；coordinator 折叠事件、维护 heartbeat、提交业务终态；HTTP adapter 只序列化 coordinator 允许发出的事件。Gateway execution engine 继续独占 provider retry/failover，不承担 messages/runs。

## 2. Current Failure Boundaries

- `route.ts:399-405` 的 `startRun` 失败仍继续模型调用，tool audit 的 run FK 随后也只能静默失败。
- `route.ts:571-645` 的必要消息事务与 `route.ts:727-741` 的 run finalize 分离；后者内部吞错，`route.ts:742-755` 仍可能发送成功终态。
- `route.ts:683-700` 在消息提交后直接 enqueue memory；commit 与 pg-boss acceptance 之间存在进程退出窗口。
- `memory/extract.ts:41-51` 把 provider/add failure 转成成功返回，worker 无法区分 retryable failure 与业务 no-op。
- `streamChatWithTools` 已在 telemetry 中聚合各轮 usage，但最终向外 yield 的 finish 仍是最后一轮 usage；业务 run metadata 因而不完整。

## 3. Module Boundaries

### 3.1 HTTP Route

拥有：session/owner 校验、body 解析、调用既有请求准备逻辑、建立 request/cancel 共用 AbortController、把 domain event 编码成现有 SSE 格式。

不拥有：run start/heartbeat、选择 plain/Agent stream、事件 fold、tool audit 调用、必要持久化、memory intent、terminal outcome 或 `finish` 判定。

### 3.2 Completion Coordinator

拥有：严格 run start、plain/Agent stream 选择、单向状态机、text/reasoning/usage/tool event fold、heartbeat 生命周期、terminal cause latch、completion repository 调用、唯一成功 terminal。

coordinator 输出现有事件形状；只有 `committed_success` outcome 可以产生 `finish`。`[DONE]` 由 SSE adapter 紧跟该唯一 finish 写出，adapter 不得自行推断成功。

### 3.3 Completion Repository

拥有：会话行锁、消息/引用条件复核、assistant insert 或 continue CAS、conversation `updatedAt`、memory intent insert、run terminal conditional update 及事务返回值。

不拥有：模型调用、SSE 编码、artifact 解析、queue 调度。

### 3.4 Memory Job Service

拥有：payload 最小化、durable row、dispatch claim、恢复扫描、worker preflight/fencing、业务成功/no-op 删除和 retryable failure 保留。

通用 worker handler 注册、全局 retry/dead-letter、所有 recovery scheduler 的启动/关闭编排留给后续 Worker/queue 子任务；本任务只做 memory adapter 能独立可靠运行所需的最小接线。

## 4. Coordinator State Machine

```text
prepared
   | signal already aborted -> cancelled_before_start
   v
starting_run -- failure --> start_failed
   |
   v
streaming -- first terminal cause --> settling
   |                                  success: upstream finish
   |                                  failed: upstream error/throw
   |                                  interrupted: abort/unexpected EOF
   v
committing -- rollback/conflict --> persistence_failed
   |
   v
committed_success | committed_failed | committed_interrupted
   |
   +-- success and controller open --> finish -> [DONE] -> close
   +-- failed and controller open  --> one error if not already sent -> close
   +-- interrupted/cancelled       --> no later controller write
```

Terminal cause is latched, not recomputed from mutable booleans:

1. upstream `finish` first：success；之后 Abort 不降级。
2. upstream error/throw first：failed；之后的异常事件不能改成 success。
3. Abort first：interrupted；停止上游并忽略后续事件。
4. 生成器无 finish/error 自然结束：interrupted，并在 controller 可写时发送现有 error envelope。
5. 一旦进入 `committing`，Abort 只关闭传输，不取消/回滚数据库事务；数据库 commit 结果仍是权威事实。

## 5. Run Lifecycle Contract

### 5.1 Start

- signal 已取消时不创建 run、不调用模型。
- `startRunStrict` 在上游调用前插入 `running` run；失败或超时向 coordinator 抛出，模型与 tool 不启动。
- startup 可以保留有界等待以保护请求响应，但“超时”只能表示未确认，不能伪造成功；晚到 running row 由现有租约自然失活。
- 只有 strict start 成功才启动 30 秒单飞 heartbeat。

### 5.2 Heartbeat And Tool Audit

- heartbeat 保持 `runId + status=running` 条件写、单飞和取消停止；它是活动投影容错，不进入核心事务。
- tool-call/tool-result 由 coordinator 调用现有脱敏 audit writer，继续属于非核心审计；strict run start 消除无 parent run 的正常路径。
- Agent 每一轮继续透传同一个 runId。`streamChatWithTools` 最终 finish usage 改为各轮 normalized usage 的和；gateway execution 仍只 finalize 一次，不新增第二套计量。

### 5.3 Terminal Update

completion transaction 使用以下条件更新并要求 `RETURNING` 恰好一行：

```text
runs.run_id = input.runId
AND runs.conversation_id = input.conversationId
AND runs.user_id = input.userId
AND runs.status = 'running'
```

零行意味着缺失、错属主或已被其他路径终结，必须回滚同事务内的 assistant、conversation 更新与 memory intent，禁止 `[DONE]`。

## 6. Completion Transaction

### 6.1 Lock Order

固定使用：`conversation FOR UPDATE -> referenced messages/CAS -> memory intent -> run terminal`。该顺序与现有 conversation title producer 的 conversation-first 规则一致；heartbeat 只碰 run，不反向锁 conversation。

### 6.2 Atomic Writes

同一 `withConversationMessageWrite` / Drizzle transaction 内：

1. 复核 conversation owner、user parent content、source 与 continue 原内容版本。
2. 普通路径插入 assistant；continue 使用原 content 条件更新同一 assistant。
3. 更新 conversation `updatedAt`。
4. 非 continue、assistant 内容非空且标准化 memory snapshot 至少两条时插入/幂等 upsert 本轮 memory intent。
5. 计算一次 `completedAt` / `durationMs`，按 terminal cause 条件终结 run。
6. 返回 committed outcome 和 success metadata；事务 commit 后 coordinator 才能发 terminal。

任何预期 CAS miss 在 run 更新前转成 domain conflict 并回滚。任何 SQL/commit 异常同样整体回滚；失败路径可以另做脱敏 best-effort 终结尝试，但该尝试不能恢复成功信号，也不能与仍在运行的 completion transaction 并发竞写。

消息状态保持现有投影：upstream finish 为 `success`；failed/interrupted 的部分消息为 `interrupted`。run 状态分别为 `success` / `failed` / `interrupted`。历史 UI 已对 interrupted message 隐藏 run metadata；`runs` 仍是唯一 metadata 事实源。

## 7. Durable Memory Intent

### 7.1 Why A Dedicated Table

title 与 memory 的过期/no-op/fencing 语义不同。建立通用 JSON event bus 会引入未被第二种真实消费者证明的抽象，也会迫使 title 做无收益迁移。因此新增专用 `memory_extraction_jobs`，只共享 outbox 原则和 recovery 形状。

### 7.2 Logical Schema

```text
memory_extraction_jobs
  id                 uuid primary key/fencing token
  run_id             text unique, FK runs(run_id) on delete cascade
  conversation_id    FK conversations(id) on delete cascade
  user_id            FK user(id) on delete cascade
  messages           jsonb not null
  dispatch_after     timestamptz not null default now()
  created_at         timestamptz not null default now()

index (dispatch_after, created_at)
```

Snapshot 在进入事务前规范化为最后 6 条、每条最多 500 字符，并只保留 `user|assistant` role；这与当前 worker 实际传给 mem0 的输入一致，同时避免复制整个请求。payload 与日志都不包含 model/provider secret 或完整 request。

### 7.3 Delivery And Completion

- producer 在 completion transaction 内按唯一 runId 写 intent。
- post-commit immediate dispatch 只是降延迟优化；条件 claim 把 `dispatchAfter` 推迟 15 分钟，queue send 成败均不删除 row。
- recovery 立即运行、每 60 秒单飞扫描、稳定顺序、每批最多 25，单条发送失败不阻断后续；stop 等待在途扫描。
- queue payload 只携带 intent id。worker 先按 id 读取当前 row；缺失是明确 no-op。
- `extractMemories` 把“已频率保护/消息不足”作为明确 no-op，把 getMemory/mem0 add/核心持久化失败作为 retryable generic error 抛出；cache invalidation 仍是派生 best-effort。
- 业务成功或明确 no-op 后，只删除同一 intent id；失败保留 row 并让 pg-boss retry。

交付语义是 at-least-once。dispatch 后崩溃或外部 mem0 成功后、DB delete 前崩溃仍可能重放；mem0 现有 infer/dedupe 降低重复影响，但本任务不声称跨系统 exactly-once。

## 8. Derived Side Effects

- conversation title：保持现有 fallback + outbox 事务和 worker fencing，不并入 completion transaction。
- artifact：纯解析可在 commit 前准备，DB insert 在 commit 后走有界 best-effort；失败/超时只记录脱敏短错误，不能改变 committed outcome。为保留当前生成后可用性，可以在固定小预算内等待后再发 success terminal，但 duration/completedAt 不包含该派生阶段。
- immediate memory dispatch：不作为 success gate；失败由 durable row 恢复。

## 9. SSE And Client Compatibility

- 保持 `user_message`、`assistant_message`、`delta`、`reasoning`、`tool_call`、`tool_result`、`search_result`、`rag_search`、`compact`、`error`、`finish` 的现有字段。
- 成功顺序固定为：identity/context events -> streamed events -> completion commit -> one `finish` -> `[DONE]`。
- 失败顺序为 streamed events -> one existing error envelope -> EOF；没有 `finish` / `[DONE]`。
- cancel 后 adapter 不 enqueue、不 close 已取消 controller。finish 先于 Abort 时 DB success 不降级，但 controller 已取消则不补写终态。
- `/v1/*` 路由和 OpenAI wire contract 不进入本改动。

## 10. Error And Privacy Boundary

- coordinator/repository 向 route 只抛 domain code + 已脱敏通用 message；原始 DB/provider error 不进 SSE。
- worker retry 使用固定通用错误，不携带 memory 文本、用户标识、连接串或 provider 细节。
- tool input/output 继续使用现有 `toSafeJsonb`；memory snapshot 不写 console。
- 测试显式传入 token/query/header 形态的敏感文本，断言 DB error、SSE 和 console 均不泄露原文。

## 11. Migration, Rollout And Rollback

- 只追加 PostgreSQL migration、journal、snapshot；不修改已发布 migration，不清空/回填业务表。
- Web 与 worker 必须协调部署，因为 memory queue payload 从完整快照收敛为 intent id；最终代码不保留双 payload 分支。
- 入口切换在一个 child 内完成：先用 characterization tests 固定 wire contract，再接 coordinator，最后删除 route 旧状态机和不再使用的 best-effort finalize 入口。
- 代码回滚不逆向删表；新表和 pending intent 保留。若回滚到旧 worker，必须协调停止新 producer，避免 payload 版本错配。

## 12. Explicit Trade-offs

- 严格 start/terminal 会在 DB 异常时牺牲“仍尝试生成”的可用性，换取可证明的 Chat 业务完成一致性。核心目标优先，选择严格模式。
- completion transaction 不跨模型生成，只在收尾短持锁，避免把网络延迟放进数据库事务。
- 不把 tool audit 提升为成功 gate；其审计价值不足以让 tool logging 短暂失败破坏已经生成的用户内容。
- 不实现跨 PostgreSQL 与 mem0 的 exactly-once；采用 durable at-least-once、fencing delete 和现有 mem0 dedupe，并把更强消费者租约留给后续 worker/reliability 演进。
