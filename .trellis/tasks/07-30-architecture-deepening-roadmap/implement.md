# Architecture Deepening Roadmap Execution Plan

## Parent Rule

父任务不执行产品代码。以下每个 child 都必须单独完成 Phase 1 planning、用户审阅和 `task.py start`；完成并归档后才进入下一项。

## Phase 0: Completed Baseline

- [x] Gateway execution engine：`07-29-gateway-execution-engine`。
- [x] Chat/Image/TTS/STT 统一 route/key 状态机与 execution/attempt telemetry。
- [x] lint、typecheck、tests、metrics smoke 和规格同步通过。

## Phase 1: Chat Completion Transaction Boundary

- [x] 进入 `07-30-chat-completion-transaction-boundary`。
- [x] 研究并审阅该 child 的 design/implement。
- [x] 实现、验证、规格同步、独立复核、归档。
- Gate：必要消息与 run 终态完成前绝不发送可靠完成信号；副作用意图可恢复。

## Phase 2: RAG File Processing State Machine

- [x] 进入 `07-30-rag-file-processing-state-machine`。
- [x] 研究并审阅该 child 的 design/implement。
- [x] 实现、运行 unit + PostgreSQL lease tests、规格同步与独立复核。
- [x] 归档。
- Gate：任一旧 lease owner 在丢失所有权后不能写 chunk 或终态。

## Phase 3: Worker And Queue Lifecycle

- [ ] 进入 `07-30-worker-queue-lifecycle`。
- [ ] 以 Phase 1 durable intent 和 Phase 2 recovery adapter 为输入完成规划。
- [ ] 实现、验证启动/失败/信号/drain 矩阵、规格同步、归档。
- Gate：启动或关闭的任一局部失败都不会留下继续调度的新工作或错误确认 job 成功。

## Phase 4: Model Catalog Sync Contract

- [ ] 进入 `07-30-model-catalog-sync-contract`。
- [ ] 核对官方资料、当前 pi 数据和项目版本后完成规划。
- [ ] 实现、验证 catalog → Chat/UI/routing/request body 全链、规格同步、归档。
- Gate：非法或不一致输入不能污染目录；权威能力降级可被正确传播。

## Phase 5: Chat Composer State Coordinator

- [ ] 进入 `07-30-chat-composer-state-coordinator`。
- [ ] 完成前端状态/持久化 race 的 characterization 与设计审阅。
- [ ] 实现、验证快速交错操作与会话切换、规格同步、归档。
- Gate：服务器最终状态与用户最后一次可见选择一致，旧会话响应不能覆盖新会话。

## Final Integration Review

- [ ] 所有 child 已完成并归档，父任务 children 全部完成。
- [ ] 运行项目全量 lint、typecheck、tests、必要的 build/PostgreSQL integration tests。
- [ ] 复核跨模块数据流、取消/租约/关闭语义、敏感信息和迁移范围。
- [ ] 更新父任务验收状态，提交路线图收尾并归档父任务。

## Activation Commands

只在用户批准相应 child 的最终 planning summary 后执行：

```bash
python3 ./.trellis/scripts/task.py start 07-30-<child-slug>
```

不得批量启动多个 child，也不得从父任务直接修改产品代码。
