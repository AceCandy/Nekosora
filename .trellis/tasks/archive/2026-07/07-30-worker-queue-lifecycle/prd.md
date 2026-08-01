# Worker 与 Queue 生命周期

## Goal

建立一个权威的 worker/queue 生命周期边界，统一 job catalog、handler 注册、恢复调度、pg-boss generation、启动回滚、真实 handler drain 与 signal shutdown。Web producer 只提交类型化领域 job，`src/worker.ts` 只负责环境校验和 runtime 组装，不再复制领域注册与清理控制流。

## User Value

- 后台任务在进程启动失败、滚动重启、信号关闭和短暂基础设施故障下具有可证明的恢复路径。
- 任务失败不会被静默确认，任务 payload、用户内容和基础设施凭据不会进入 worker/queue 日志或 pg-boss failure output。
- 新增后台任务时只需增加一个 catalog/worker definition，不再同时修改多套启动、恢复和关闭代码。

## Confirmed Facts

- `src/worker.ts:16-135` 当前手写三个 handler、三个 recovery scheduler、signal shutdown 与逐项启动回滚。
- `src/lib/infra/queue.ts:55-143` 当前在一个 pg-boss 实例上维护 start/stop、同名 queue promise 和 active API operation；`activeOperations` 只覆盖 send/work 注册，不直接表达 handler drain。
- `pg-boss@11.1.2` 的 `stop()` 默认会以 `graceful=true, wait=true, timeout=30000` 轮询 WIP；超时后仍调用 `failWip()`，把 active job 转成 retry/failed，并以成功 Promise 返回。当前 adapter 没有检测该超时结果。
- `pg-boss@11.1.2` 的 `start()` 在内部启动步骤抛错时不会清除 `#starting`。因此仅清空 adapter 的 `startPromise` 不能让同一个 pg-boss 实例可靠重试，失败实例必须被清理并替换。
- 当前 `stopPromise` 检查与 operation 登记之间没有 `await`，JavaScript run-to-completion 已提供同步线性化点；本任务不把这里误判为可插入的 event-loop race。
- 三个 queue 当前都继承 pg-boss 默认策略：`retryLimit=2`、`retryDelay=0`、`retryBackoff=false`、`expireInSeconds=900`，项目没有显式 job policy 事实源。
- `memory-extract` 与 `conversation-title` 使用数据库 durable row、15 分钟 claim window、立即及每 60 秒恢复；`file-process` 使用 `file_objects` 状态与 lease 恢复。三个 recovery 都是 single-flight、每轮最多 25 条并逐项隔离失败。
- file/title 具备 lease/job fencing；memory durable intent 明确是 at-least-once，现有推断/去重只降低重复执行影响，不构成 exactly-once。本任务无需新增 schema、迁移或数据重置。

## Requirements

- R1. 一个 worker runtime 必须拥有 `idle -> starting -> running -> stopping -> stopped` 生命周期，领域入口不得再手写注册顺序、scheduler timer 或 cleanup tree。
- R2. file、memory、title 必须使用同一个类型化 job definition contract；queue name、payload type、有限 retry/expiry policy 与安全失败消息只有一个 catalog 事实源。
- R3. Queue adapter 必须保留单例 API，但底层 pg-boss 使用可替换 generation。构造/start/stop 失败或正常 stop 后不得复用旧 generation；后续调用必须创建并启动新实例。
- R4. 并发 start、同名 queue 创建、send/work、stop/start 与 stop single-flight 必须有确定顺序。stop 关闭当前 generation 的新 operation admission，等待已接纳 API operation，再显式执行 pg-boss graceful stop。
- R5. Queue adapter 必须跟踪真实业务 handler并测量 monotonic stop deadline。正常 stop 只在 30 秒内完成且 handler set 为空时成功；跨过 deadline 或仍有 handler 时，即使 pg-boss 返回成功也必须报告稳定 shutdown failure，供 worker 非零退出。
- R6. Handler 必须显式返回 `completed` 或 `noop`；任何可恢复异常必须拒绝 queue callback。runtime 在 queue 边界把异常收敛为 definition 提供的稳定通用错误，不携带原始 cause/stack。
- R7. Recovery scheduler 的 immediate run、60 秒 unref timer、single-flight、scan failure isolation 与 stop-drain 必须由一个通用 scheduler 实现；领域模块只保留一轮 recovery 的业务函数。
- R8. 启动顺序固定为 queue generation -> 全部 handler registration -> 全部 recovery scheduler。任一步失败时反向清理所有已启动资源，cleanup failure 不覆盖原始启动错误。
- R9. SIGINT/SIGTERM 必须共享一个 shutdown Promise。shutdown 先阻止新 recovery round 并等待在途 scan，再 drain/stop queue；任一 cleanup 或 drain failure 都继续剩余清理并只调用一次 `exit(1)`。
- R10. Queue payload 必须最小化为 durable identifier：file 使用 `{ fileId }`，memory/title 使用 `{ id }`。title 不再把首条用户消息、fallback、模型信息复制进 pg-boss payload。
- R11. Queue/worker 日志只允许稳定 stage、job name 与 outcome；不得记录完整 payload、用户内容、job/conversation/file id、原始异常、连接串、provider URL、header 或凭据。
- R12. pg-boss/pg 继续通过变量路径动态 import 隔离 Node-only driver；共享 job catalog 不得静态引入 worker runtime 或领域 handler，Next Edge instrumentation/build 必须继续通过。
- R13. Web producer 必须能独立 cold-start queue generation、创建 queue 并发送，不依赖 worker 已启动或已注册 handler。
- R14. 本任务不修改 public schema、Drizzle migration、业务数据或 pg-boss job 数据；现有 queue name 与 durable recovery contract 保持不变。

## Acceptance Criteria

- [x] `src/worker.ts` 只执行环境校验、变量路径加载与 runtime 组装，不包含领域专用 handler/recovery/cleanup 分支。
- [x] 一个共享 catalog 定义三个 queue 的 name、payload 与显式有限 policy；所有 producer 和 worker definition 均引用该 catalog，生产代码不再散落 queue name 字面量。
- [x] file、memory、title handler 测试分别覆盖 `completed`、明确 `noop` 和稳定 retryable rejection；title pg-boss payload 仅含 job id。
- [x] start 失败后下一次调用构造新的 pg-boss generation；正常 stop、stop failure 后也不复用旧实例。
- [x] 并发 cold start、start/stop、stop/start、双 stop、同名 create、不同名 create、stop 中 send/work 与 API operation drain 测试全部通过。
- [x] 执行中的真实 handler 会阻止正常 stop 完成；mock race 与真实 PostgreSQL/pg-boss 11.1.2 验证 30 秒 deadline 后的 late completion 仍被识别为 shutdown failure，job 进入 retry/failed，worker 非零退出。
- [x] 三个 recovery 共用一个 scheduler contract；立即执行、interval single-flight、stop 等待 active scan 与 scan failure isolation 均有定向测试。
- [x] 每个 handler registration/recovery startup 阶段失败的回滚矩阵证明反向清理；cleanup 多重失败仍继续，原始启动错误不变。
- [x] SIGINT/SIGTERM 在异步 shutdown 未完成时重复触发仍只运行一轮 recovery/queue stop 和一次 exit；失败路径 exit code 为 1。
- [x] 日志与 pg-boss callback error 测试证明 payload、用户文本、id、数据库 URL、provider URL、header、credential、cause 与 stack 不泄露。
- [x] memory/title durable intent 在 immediate send 失败或进程重启后仍由原有 15 分钟 claim/recovery 收敛；RAG pending/stale lease recovery 行为不变。
- [x] `pnpm build` 通过，证明共享 catalog 与 worker runtime 没有破坏 Edge instrumentation 的动态 import 边界。
- [x] `src/db/schema/pg.ts`、`drizzle/pg/**` 与业务数据清理脚本无 diff。

## Dependencies

- `07-30-chat-completion-transaction-boundary` 已完成并归档；memory durable intent contract 可直接复用。
- `07-30-rag-file-processing-state-machine` 已完成并归档；file coordinator、lease 与 recovery round contract 可直接复用。

## Out Of Scope

- 重写 RAG extract/chunk/embed、memory 抽取或 title 生成算法。
- 替换 pg-boss/PostgreSQL，增加 Redis/MQ，或新增独立 worker 服务协议。
- 新增 dead-letter UI、worker liveness endpoint、分布式 leader election 或动态 worker concurrency 配置。
- 改变 Web/API wire contract、readiness 对独立 worker 存活性的含义，或把 queue acceptance 当作业务完成。
- 修改 public schema、Drizzle migration、清空业务表或 pg-boss 积压任务。

## Planning Decisions

- 接受一次性内部 API cutover，不保留 string-based queue overload、三套 scheduler wrapper 或旧 worker cleanup tree。
- 显式 policy 先钉住 `pg-boss@11.1.2` 当前有效默认值，避免本任务同时改变重试次数与用户可见时序；后续调参只改 catalog。
- drain timeout 固定为 30 秒并把超时视为失败，不新增未经要求的环境变量。正常 handler 完成是成功退出，超时由 pg-boss 重新排队/终止并由进程非零退出暴露。
- queue adapter 以 monotonic deadline 加 handler set 检测 pg-boss 的“超时后仍 resolve”行为；deadline 是保守边界，接近 30 秒才完成也按不完整关闭处理，但不绕过或复制 pg-boss 的 worker polling/ack 状态机。
- 共享 catalog 与 generic runtime 分离：catalog 可被 Web producer 安全静态导入，runtime/领域 definitions 仅由 worker 变量路径加载。
