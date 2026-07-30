# 架构深化路线图

## Goal

以已完成的 Gateway execution engine 为基础，按可靠性与依赖顺序继续深化 Nekusora 的 Chat 完成事务、RAG 文件处理、Worker/queue 生命周期、模型目录同步和 Chat Composer 状态边界。每个方向必须形成有杠杆的深模块，而不是继续在 route、worker 或组件中累积补丁式控制流。

## Background

- 用户明确接受大规模、高风险高收益重构以及必要的破坏性内部统一，但核心目标优先于工作量。
- Phase 0 `07-29-gateway-execution-engine` 已完成并归档：Chat、Image、TTS、STT 已共享 route/key 执行状态机和 execution/attempt 观测模型。
- 当前仍有五个相互有关但可独立验收的控制流边界，不能作为一个超大提交同时实施。
- 本父任务只维护总体图纸、依赖顺序和最终集成门禁，不直接承载产品代码实现。

## Requirements

- R1. 每个子任务必须拥有单一明确的状态机或生命周期所有者；调用方只表达领域输入，不重新编排内部步骤。
- R2. 子任务必须逐个规划、审批、实现、验证和归档；任何时刻只激活一个实现子任务。
- R3. 子任务边界必须独立可测、可回滚，不得通过跨任务的半成品接口维持运行。
- R4. 保持 `/v1/*` OpenAI SDK wire contract、WebChat 历史/SSE 兼容、现有鉴权与数据属主隔离。
- R5. `model_catalog` 继续作为模型能力与推理档位唯一事实源；前端、routing 和 provider request translation 不得复制能力判断。
- R6. `runs`、`tool_calls`、messages、模型、Provider、route、API key 和用户数据不得因架构整理被清空或破坏性替换。任何数据迁移须在所属子任务重新获得明确批准。
- R7. 原始凭据、provider header/base URL、完整请求体和调试产物不得跨安全域或进入日志、任务文档、commit message。
- R8. 每个子任务完成时必须同步相关 `.trellis/spec/`、运行定向与全量门禁，并接受一次独立复核。

## Task Map

| 顺序 | 任务 | 优先级 | 依赖 | 状态 |
|---|---|---|---|---|
| 0 | Gateway execution engine | P1 | 无 | 已完成：`archive/2026-07/07-29-gateway-execution-engine` |
| 1 | Chat 完成事务边界 | P1 | Phase 0 | 已完成：`archive/2026-07/07-30-chat-completion-transaction-boundary` |
| 2 | RAG 文件处理状态机 | P1 | 无代码依赖；顺序上晚于 Phase 1 | 已完成：`archive/2026-07/07-30-rag-file-processing-state-machine` |
| 3 | Worker 与 Queue 生命周期 | P1 | Phase 1 的 durable intent 契约、Phase 2 的 recovery/lease 契约 | 已完成：`archive/2026-07/07-30-worker-queue-lifecycle` |
| 4 | Model Catalog 同步契约强化 | P1 | 独立；为降低并行大改风险排在 Phase 3 后 | 已完成：`archive/2026-07/07-30-model-catalog-sync-contract` |
| 5 | Chat Composer 状态协调 | P2 | Phase 1 稳定 Chat 完成边界 | 已完成：`archive/2026-07/07-30-chat-composer-state-coordinator` |

## Acceptance Criteria

- [x] 五个子任务均有收敛后的 PRD；被选中实现前另行完成 design、implement、context manifests 和启动审批。
- [x] 五个子任务按 Task Map 顺序完成并归档，没有重叠实现或临时兼容层遗留。
- [x] Chat 的模型终态、消息提交、run 终态、durable intent 与 SSE `[DONE]` 具有一个权威完成协议。
- [x] RAG 的 claim、lease、heartbeat、阶段转换、fencing 和 recovery 由一个状态机边界拥有。
- [x] Worker/queue 的注册、启动、handler 失败、恢复调度、drain 和 shutdown 由一个生命周期边界拥有。
- [x] Catalog 同步支持权威能力降级、输入规范化和跨字段原子 invariant fallback，且运行时消费者继续只读目录。
- [x] Composer 快速连续切换不会因闭包快照或异步返回乱序覆盖最新选择。
- [ ] 最终集成复核证明五个模块之间的数据流、错误语义、取消语义和关闭顺序一致；全量质量门禁通过。

## Out Of Scope

- 在父任务中直接实现任何子任务。
- 重做已完成的 Gateway execution engine 或恢复旧日志双表。
- 新增产品功能、重设计 Chat UI、替换 PostgreSQL/pg-boss/Drizzle/AI SDK。
- 将进程内 circuit breaker 改为分布式 breaker。
- 未经子任务审批扩大到数据清理或业务数据重建。

## Key Decisions

- 按“用户数据完成一致性 → 后台处理一致性 → 进程生命周期 → 控制面目录 → 前端交互状态”排序，不按实现难度排序。
- Gateway execution engine 作为已完成基线引用，不创建重复子任务。
- Parent 保持规划/协调角色；每个 child 都必须在后续单独完成规划审阅后才能 `task.py start`。
