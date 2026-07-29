# Worker 与 Queue 生命周期

## Goal

建立统一 worker runtime/lifecycle module，集中 job 注册、queue 启动、handler 失败传播、recovery scheduler 所有权、active-operation drain、signal shutdown 与启动回滚，消除 `queue.ts` 和 `worker.ts` 之间的生命周期拼装。

## Background

- `src/lib/infra/queue.ts` 已有 start/stop、lazy queue 和 active operation 状态机。
- `src/worker.ts` 另行注册三类 handler、启动两类 recovery、处理信号和逐项清理。
- 各领域 job 对 retryable failure、业务 no-op、幂等和恢复的表达并不统一。

## Requirements

- R1. Worker lifecycle 通过显式 job/recovery definitions 注册领域 adapter；入口不再手写每个 handler 和 stop 顺序。
- R2. Queue adapter 继续保证并发 start/create、stop/start race、active operation drain 和失败后可重试初始化。
- R3. Handler 必须区分成功、幂等 no-op 与 retryable failure；失败不得被 catch 后静默确认成功。
- R4. 启动阶段任一注册或 scheduler 失败时，已启动资源按反序全部清理，原始安全错误继续抛出。
- R5. SIGINT/SIGTERM 共享幂等 single-flight shutdown：先停止新 recovery 调度并等待 in-flight，再 drain/stop queue，最后以正确 exit code 退出。
- R6. Queue/recovery 日志不得包含 job 完整 payload、用户内容或凭据；必要 attempt/terminal 观测使用低基数字段。
- R7. 保持 pg-boss/pg 的变量路径动态 import，Next Edge instrumentation/build 不得引入 Node-only 驱动。
- R8. Web producer 不依赖 worker 已启动；send 自行保证 queue backend/queue name 就绪。

## Acceptance Criteria

- [ ] `startWorker` 只组装 lifecycle module，不再包含领域专用 try/catch shutdown 树。
- [ ] file、memory、title job 均以同一 definition contract 注册，业务 no-op 与失败测试明确。
- [ ] 并发 cold start、createQueue 失败重试、stop 期间 send/work、active send drain 全部通过。
- [ ] 任一 scheduler stop 或 queue stop 失败时仍继续清理其余资源，并返回失败 exit code。
- [ ] 两次信号只执行一次 shutdown；shutdown 开始后不启动新 recovery 或 handler registration。
- [ ] Next build/Edge instrumentation 验证动态 import 边界。
- [ ] RAG recovery 与 Chat durable intent 在进程重启、queue 暂时不可用场景可恢复。

## Dependencies

- 必须等待 `07-30-chat-completion-transaction-boundary` 的 durable intent contract。
- 必须等待 `07-30-rag-file-processing-state-machine` 的 handler/recovery adapter contract。

## Out Of Scope

- 重写 RAG、memory 或 title 的领域算法。
- 替换 pg-boss，或引入新的消息中间件。
- 将 worker 存活性伪装成 Web readiness；readiness 只证明本进程可初始化 queue backend。

## Planning Gate

实现前必须枚举全部 producer/handler/recovery，决定 job definition 与错误结果 contract，并形成启动/关闭状态机、build gate 和回滚计划。
