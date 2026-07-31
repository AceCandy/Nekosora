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

- [x] 进入 `07-30-worker-queue-lifecycle`。
- [x] 以 Phase 1 durable intent 和 Phase 2 recovery adapter 为输入完成规划。
- [x] 实现、验证启动/失败/信号/drain 矩阵、规格同步、归档。
- Gate：启动或关闭的任一局部失败都不会留下继续调度的新工作或错误确认 job 成功。

## Phase 4: Model Catalog Sync Contract

- [x] 进入 `07-30-model-catalog-sync-contract`。
- [x] 核对官方资料、当前 pi 数据和项目版本后完成规划。
- [x] 实现、验证 catalog → Chat/UI/routing/request body 全链、规格同步、归档。
- Gate：非法或不一致输入不能污染目录；权威能力降级可被正确传播。

## Phase 5: Chat Composer State Coordinator

- [x] 进入 `07-30-chat-composer-state-coordinator`。
- [x] 完成前端状态/持久化 race 的 characterization 与设计审阅。
- [x] 实现、验证快速交错操作与会话切换、规格同步、归档。
- Gate：服务器最终状态与用户最后一次可见选择一致，旧会话响应不能覆盖新会话。

## Final Integration Review

- [x] 所有 child 已完成并归档，父任务 children 全部完成。
- [x] 运行项目全量 lint、typecheck、tests、必要的 build/PostgreSQL integration tests。
- [x] 复核跨模块数据流、取消/租约/关闭语义、敏感信息和迁移范围。
- [ ] 更新父任务验收状态，提交路线图收尾并归档父任务。

## Final Verification Record

- `pnpm lint` 与 `pnpm typecheck` 通过；全量 Vitest 为 117 个文件通过、2 个文件跳过，981 个用例通过、17 个用例跳过。
- `pnpm build` 通过，19 个静态页面生成完成；Chat、公开 `/v1/*`、管理端和 Edge instrumentation 均完成 production 编译。
- RAG lease 隔离 PostgreSQL gate：14/14；queue lifecycle gate：clean drain 与 30 秒 timeout 均通过；Chat completion 原子事务 gate：3/3。
- 三个 gate 均使用随机前缀临时数据库并在 `finally` 删除；最终残留数据库计数为 0。
- 跨模块复核确认：Gateway 不写 Chat 业务终态；Chat completion transaction 同事务写 assistant/run/memory intent；worker 是 queue 注册、recovery 与 shutdown 的唯一 owner；RAG 终态受 DB lease/token fencing；model catalog capabilities 贯穿 UI、routing 与 request translation；Composer 不复制能力判断。
- 集成复核修复了共享错误边界未移除基础设施 URL、RAG retrieve 与 Chat compaction 直接记录原始 `Error` 的隐私缺陷；定向测试 33/33 通过。
- 未验证：认证后的 Chat 桌面与 390px 浏览器交互，沿用 Composer child 的登录态限制；未读取或创建本地凭据。
- 保留协议风险：失败/中断 Chat SSE 不补 `[DONE]`，客户端依赖 error frame 或连接关闭；现有 route test 明确锁定该契约，本任务未擅自改变 wire behavior。

## Activation Commands

只在用户批准相应 child 的最终 planning summary 后执行：

```bash
python3 ./.trellis/scripts/task.py start 07-30-<child-slug>
```

不得批量启动多个 child，也不得从父任务直接修改产品代码。
