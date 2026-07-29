# Chat 完成事务边界

## Goal

建立单一 Chat completion coordinator，统一 Gateway 模型终态、assistant 消息持久化、`runs` 终态、可恢复后置副作用意图与 SSE `finish`/`[DONE]` 的可靠完成协议，避免 route 内多个布尔值和 best-effort 写入共同决定用户可见成功。

## Background

- `src/app/api/chat/route.ts:436-755` 当前同时拥有 stream controller、heartbeat、模型事件、消息事务、artifact、memory enqueue、run finalize 和终态 SSE。
- 现有代码已做到必要消息持久化后才发送 `[DONE]`，但 run finalization 仍为独立 best-effort 边界，memory enqueue 失败只有 console 记录。
- Gateway execution engine 已负责 provider 执行；本任务只处理 WebChat 业务完成，不得重建 retry/failover。

## Requirements

- R1. 新 coordinator 必须拥有从模型事件开始到业务终态完成的单向状态机；route 只负责鉴权、输入解析和 HTTP/SSE adapter。
- R2. 必要 assistant/continue 消息提交与 run 终态必须形成一个明确完成协议；任一步骤未可靠收敛都不得向客户端宣告成功。
- R3. `finish` 和 `[DONE]` 只在必要消息已提交、run 已可靠终结且终态 metadata 已确定后发送。
- R4. 客户端 Abort/ReadableStream cancel 停止 heartbeat 和后续写入，终态为 interrupted；不得向关闭 controller 追加 error 或 `[DONE]`。
- R5. tool-call/tool-result、普通 Chat、重试、编辑重发和续写必须保持同一 `runId` 归属与现有消息分支语义。
- R6. memory/title 等后置工作必须明确分类为事务内必要写、durable intent 或真正 best-effort；需要最终交付的工作不得只靠 fire-and-forget + console。
- R7. artifact 等派生数据失败不得反向破坏已提交的核心消息，除非 planning 明确将其提升为必要完成条件。
- R8. 保持 WebChat SSE payload、历史投影和 Gateway `/v1/*` wire contract；`runs/tool_calls` 不并入 gateway execution 表。

## Acceptance Criteria

- [ ] route 不再直接编排 heartbeat、消息提交、run finalize 与 terminal SSE 的完整状态机。
- [ ] 正常完成只产生一个 success run、一个必要 assistant 终态和一组 `finish` + `[DONE]`。
- [ ] 消息写入失败或 run 终结失败不会发送 `[DONE]`，客户端收到脱敏失败终态。
- [ ] Abort 在生成前、生成中、持久化前后均有测试，且不会降级已可靠完成的 success。
- [ ] Agent 多轮与 tool audit 共用一个 run，最终 usage/metadata 不重复计量。
- [ ] memory/title 等需要交付的副作用在进程退出或 queue 暂时不可用后仍有可恢复事实。
- [ ] 并发续写/编辑条件写仍阻止旧请求覆盖新内容。
- [ ] route、coordinator、repository 和真实数据库边界测试覆盖完整终态矩阵。

## Dependencies

- 已完成：`07-29-gateway-execution-engine`。
- 输出契约将被 `07-30-worker-queue-lifecycle` 消费。

## Out Of Scope

- Provider route/key retry、breaker 或 gateway telemetry。
- RAG 文件处理状态机、通用 worker shutdown、Chat Composer UI 状态。
- 改变 Chat 产品功能或 SSE 对外字段。

## Planning Gate

实现前必须进一步决定核心消息与 run 是否同一 PostgreSQL 事务、durable intent 的表边界、以及 artifact 的必要/派生分类，并形成 `design.md` 与 `implement.md` 后重新请用户审批。
