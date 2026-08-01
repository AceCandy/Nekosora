# Chat 完成事务边界

## Goal

建立单一 Chat completion coordinator，把一次 WebChat 生成从 run 启动、模型事件收敛、必要 assistant 持久化、run 终态、可恢复后置意图到 SSE 成功信号统一为一个可靠协议。用户只能在核心业务事实已经提交后看到 `finish` / `[DONE]`，失败、取消和进程退出不能再被多个 best-effort 布尔值伪装成成功。

## User Outcome

- 正常生成、重试、编辑重发、续写和 Agent 多轮都只有一个可解释的业务终态。
- 刷新后的消息、run metadata、tool audit 与流式完成结果属于同一 `runId`，不会出现“前端已完成但数据库仍 running”的成功假象。
- 队列暂时不可用或 Web 进程在消息提交后退出时，记忆提取仍有可恢复事实。

## Confirmed Facts

- `src/app/api/chat/route.ts:436-770` 当前同时拥有 heartbeat、模型事件、消息事务、artifact、memory enqueue、run finalize 和 terminal SSE。
- 必要消息失败时当前不会发送 `[DONE]`，但 `finalizeRun` 在 `src/lib/chat/run-lifecycle.ts:227-246` 内吞掉数据库失败并返回 `void`，调用方无法确认 run 是否真正终结。
- `memory-extract` 当前由 route 直接 fire-and-forget；队列失败只写 console。`extractMemories` 又会吞掉核心 provider/add 失败，使 worker 可能错误确认 job 成功。
- 标题 fallback 与 `conversation_title_jobs` 已有事务内 outbox、条件 claim、fencing 和恢复扫描，本任务复用其可靠性原则，不重写标题领域状态机。
- Agent loop 已共享一个 `runId`，gateway telemetry 聚合各轮 usage，但当前对外最终 `finish` 仍携带最后一轮 usage，不能直接代表整个业务 run。

## Requirements

- R1. 新 coordinator 必须拥有生成开始到业务终态的单向状态机；route 只保留鉴权、请求解析/准备和 HTTP/SSE 适配，不再直接编排 heartbeat、模型事件、消息提交、run finalize 与成功终态。
- R2. run 必须在调用任何上游模型或写 tool audit 前可靠创建。run 创建失败时不得启动模型生成，也不得发送成功信号。
- R3. 必要 assistant/continue 写入、conversation 活动时间、run 终态与本轮 memory durable intent 必须形成一个 PostgreSQL 完成事务；run 条件终结未命中时整个事务失败。
- R4. `finish` 和 `[DONE]` 只表示成功完成事务已经提交；生成失败、生成器异常结束、消息条件写失败、run 终结失败或事务异常都不得发送成功终态。
- R5. request Abort 与 `ReadableStream.cancel()` 必须停止上游和后续 heartbeat，并禁止再写 controller。模型 `finish` 一旦先到达就是权威成功，之后的 Abort 不得降级已提交或正在提交的成功；Abort 先到达则终态为 interrupted。
- R6. 普通 Chat、重试、编辑重发、续写和 tool/Agent 多轮必须保持现有消息分支语义并共享本轮唯一 `runId`。整个 Agent run 的 run metadata 使用聚合 usage，不能只取最后一轮，也不能重复计量。
- R7. memory 提取必须使用 durable at-least-once intent：核心事务提交后即使进程退出或 queue 暂时不可用也能恢复；只有业务成功或明确 no-op 才完成 intent，retryable failure 必须保留事实并向 worker 抛出通用错误。
- R8. conversation title 继续使用现有专用 outbox；artifact 继续是派生 best-effort 数据，失败或超时不能回滚核心事务或抑制已确认的成功终态。
- R9. 保持既有 WebChat SSE event 字段、历史消息投影、鉴权/属主隔离与 Gateway `/v1/*` OpenAI wire contract；`runs/tool_calls` 不并入 gateway execution 表。
- R10. 错误只允许以现有脱敏 envelope、稳定通用 worker error 和短日志越过边界；memory payload、完整请求、凭据、provider header/base URL 不得进入日志。
- R11. 本任务只追加 forward PostgreSQL migration，不清空或重建 messages、runs、tool_calls、conversation、模型、Provider、route、API key 或用户数据，也不回填历史 memory job。

## Acceptance Criteria

- [ ] `/api/chat` 不再直接拥有 heartbeat、模型事件 fold、completion transaction、run finalize 和 `finish` / `[DONE]` 决策。
- [ ] run 创建失败时模型与 tool 均未调用，客户端只得到脱敏失败终态且没有 `finish` / `[DONE]`。
- [ ] 正常完成原子提交必要 assistant、conversation `updatedAt`、success run 和应有的 memory intent，随后只发送一组 `finish` + `[DONE]`。
- [ ] 消息写入、continue CAS、run 条件终结、intent 写入或事务 commit 任一失败时不存在半提交的核心完成事实，也不发送成功终态。
- [ ] upstream error、无 `finish` EOF、Abort 先到、`finish` 先到及 commit 期间 Abort 均有确定测试；controller 取消后没有后续 enqueue/error/`[DONE]`/close。
- [ ] Agent 多轮只产生一个业务 run、一个最终 success signal 和一份跨轮聚合 token usage；tool-call/tool-result 仍归属该 run。
- [ ] queue send 失败、Web 进程在 commit 后退出、worker 暂停后恢复三种场景都保留并最终处理同一 memory intent。
- [ ] memory provider/add 失败不会被 worker 确认为成功；成功、少于最低消息数或频率保护等明确 no-op 才删除匹配 intent。
- [ ] 并发续写/编辑条件写仍阻止旧请求覆盖新内容；continue 仍不创建 artifact 或 memory intent。
- [ ] title outbox、历史 run metadata、public share 投影和 `/v1/*` wire contract 回归测试保持通过。
- [ ] PostgreSQL migration、Drizzle journal/snapshot、schema、coordinator、repository、route、SSE、memory dispatch/recovery 和真实事务边界测试覆盖完整矩阵。

## Key Decisions

- `finish` / `[DONE]` 从“流已结束”收紧为“成功 completion transaction 已提交”；失败路径通过 `error` + EOF 收敛，取消路径不再写 controller。
- start/finalize 不再共同使用旧的 best-effort 成功语义：start 是生成前强制门禁，terminal update 是核心事务的一部分；heartbeat 和 tool audit 仍可保持非核心容错。
- memory 使用专用 durable intent，而不是建立通用事件总线或强行合并语义不同的 title outbox。
- memory 的交付保证为 durable at-least-once；外部 mem0 的 exactly-once 不在本任务承诺范围内。
- 不保留新旧 completion 编排双轨；入口迁移完成后删除 route 中的旧状态机。

## Dependencies

- 已完成：`07-29-gateway-execution-engine`。
- 本任务输出 memory job/recovery adapter 契约，供后续 `07-30-worker-queue-lifecycle` 统一注册、retry policy、scheduler ownership 与 shutdown 顺序。

## Out Of Scope

- Provider route/key retry、breaker、gateway telemetry 或 `/v1/*` 协议重写。
- RAG 文件状态机、通用 worker runtime 重构、全局 queue retry/dead-letter 策略。
- 重写 conversation title 状态机、把 title 与 memory 合并为通用 JSON outbox。
- 保证外部 mem0 exactly-once、重新设计记忆产品策略或回填历史对话。
- Chat Composer UI 状态、聊天产品功能或 SSE 字段新增。

## Data Impact

- 追加一张 memory durable-intent 表及其索引/FK，并同步 Drizzle migration journal/snapshot。
- 现有业务表只进行正常条件写；没有清表、破坏性替换或历史回填。
- 回滚代码时新表和未消费 intent 保留，需与 Web/worker 代码协调回滚；不执行逆向删表迁移。
