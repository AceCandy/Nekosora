# Worker And Queue Lifecycle Evidence

## Scope

本研究记录架构深化路线图第三个 child 的现状、第三方版本语义、job/recovery 矩阵、测试缺口与规划取舍。只覆盖 worker/queue lifecycle；不重写 RAG、memory、title 算法，不修改 public schema 或清理数据。

## Current Ownership Split

- `src/worker.ts:16-28`：环境校验后动态加载 queue 与三个领域 handler/recovery。
- `src/worker.ts:32-65`：固定执行 queue start、三个 work registration、三个 recovery start。
- `src/worker.ts:67-106`：SIGINT/SIGTERM 共用 shutdown Promise，按 title -> memory -> file -> queue 停止，任一失败最终 exit 1。
- `src/worker.ts:107-135`：startup catch 再实现一套按反序 best-effort cleanup，并保留原始启动错误。
- `src/lib/infra/queue.ts:55-143`：adapter 内另有 start/stop、queue creation、active API operation 与 pg-boss callback wrapper。

因此领域装配、恢复 timer、进程 shutdown 和基础设施 generation 分属两个文件，没有一个模块能单独证明完整生命周期。

## Queue Adapter Facts

- `src/lib/infra/queue.ts:26-53`：`getQueue` build 期间构造单个 pg-boss，并用变量路径 import 保护 Edge build；error event 当前直接输出 raw error。
- `src/lib/infra/queue.ts:55-70`：同一实例用 `startPromise` single-flight；失败只清 adapter promise。
- `src/lib/infra/queue.ts:72-87`：stop 捕获 start failure、对 active operation 取 settled snapshot，再调用无显式 options 的 `boss.stop()`。
- `src/lib/infra/queue.ts:89-103`：runOperation 等待 start；stop 在途时等待 stop 后重试；operation promise 在同一同步 turn 登记。
- `src/lib/infra/queue.ts:105-115`：同名 createQueue promise 复用，失败后可重试。
- `src/lib/infra/queue.ts:119-139`：send 只透传 `startAfter`；work 对 pg-boss batch 顺序 await handler，第一个 rejection 终止本批。
- 三个 recovery round 当前逐项 failure log 分别包含 file/job id；即使 error message 已做 URL/secret redaction，实体 id 仍不满足本任务的低基数 worker logging 目标。

此前把 `runOperation` 的 stop 检查与 operation 登记描述为 event-loop race 并不准确：两者之间没有 `await`，JavaScript run-to-completion 不允许另一个 stop continuation 插入。真正缺失的是显式 generation identity、第三方 start failure 后的 instance replacement，以及 handler timeout 的可观察结果。

## PgBoss 11.1.2 Source Contract

项目声明 `pg-boss:^11.0.0`，`pnpm-lock.yaml` 实际锁定 `11.1.2`。

### Start Failure Poisoning

- `node_modules/pg-boss/src/index.js:107-138`：`start()` 在进入异步步骤前设置 `#starting=true`。
- open/contractor/manager/boss/timekeeper 任一步 reject 时没有 catch/finally 清除 `#starting`。
- 后续 `start()` 在 `#starting || #started` 时直接返回 instance。

结论：当前 adapter 测试只证明 mock promise 可重试，没有证明真实 pg-boss instance 可重试。可靠恢复必须丢弃失败 instance，并由 adapter singleton 创建新 generation。

### Graceful Stop And Timeout

- `node_modules/pg-boss/src/index.js:141-154`：stop 默认 `close=true, graceful=true, timeout=30000, wait=true`，先停止 manager/timekeeper/boss。
- `node_modules/pg-boss/src/index.js:185-201`：graceful+wait 每 500ms 轮询非 internal WIP，直到为空或超时。
- `node_modules/pg-boss/src/index.js:156-177`：无论正常 drain 或超时都执行 `manager.failWip()`、关闭 DB、标记 stopped 并 resolve。
- `node_modules/pg-boss/src/manager.js:196-218`：worker 在 callback 完成/失败并 complete/fail 后才清 WIP。
- `node_modules/pg-boss/src/manager.js:233-263`：`offWork()` 只触发 worker.stop，异步轮询 removal，自身不等待。
- `node_modules/pg-boss/src/worker.js:41-87`：已开始的 callback 会继续到 `onFetch` 完成，之后 worker 才 stopped；`Worker.stop()` 不取消 callback。
- `node_modules/pg-boss/src/manager.js:109-116` 与 `plans.js:756-813`：超时 failWip 后，有剩余 retry 的 job 进入 retry，否则进入 failed。

结论：必须使用公开 graceful/wait stop，不调用 private/offWork 重建机制。仅在 boss.stop resolve 后检查 callback set 仍可能漏掉“超时后 failWip 期间 callback 恰好完成”的窗口；adapter 必须同时检查 monotonic elapsed deadline 与 callback set，且用真实 PostgreSQL 验证 job 状态。

### Effective Queue Defaults

`node_modules/pg-boss/src/plans.js:25-33` 定义：

- `retry_limit=2`；
- `retry_delay=0`；
- `retry_backoff=false`；
- `expire_seconds=900`；
- retention 14 天、deletion 7 天。

当前三个 producer 都未显式传 retry/expiration，因此依赖这些版本默认。规划把前四项钉入 shared catalog，不在本任务改变 policy timing。

## Producer / Handler / Recovery Matrix

### `file-process`

- Producer：`src/app/api/upload/route.ts:90-110` 先写 pending `file_objects`；`120-145` 发送 `{fileId,storagePath,mime}`，queue failure 时调用 `processFile(fileId)` fallback。
- Handler：`src/worker.ts:37-43` 实际只使用 `fileId`。
- Outcome：`src/lib/rag/processing-coordinator.ts:58-66` claim miss no-op；`74-103` unsupported/empty 正常完成；`180-189` lease loss no-op，其他 owned failure 写 stable error 后抛通用 retryable error。
- Durable fact：`file_objects` state/lease。`processing-repository.ts:69-127` 使用 file/token/status/fresh lease fencing。
- Recovery：`src/lib/rag/recovery.ts:8-20` 逐项 process；`23-55` 立即+60 秒 single-flight scheduler。

### `memory-extract`

- Producer：`src/lib/chat/completion-repository.ts:86-88` 在 completion transaction 插 durable row；`completion-coordinator.ts:244-250` post-commit immediate dispatch。
- Dispatch：`src/lib/memory/dispatch.ts:11-29` 原子把 `dispatchAfter` 推后 15 分钟，再发送 `{id}`。
- Handler：`src/lib/memory/jobs.ts:37-61` missing row no-op；extract 成功/no-op 后删除；异常保留 row 并 reject。
- Recovery：`dispatch.ts:31-56` 到期最多 25 条顺序重投并隔离单项失败；`58-90` 立即+60 秒 single-flight scheduler。

### `conversation-title`

- Producer：`src/lib/conversation-title/service.ts:52-109` 在同一事务写 fallback 与完整 outbox；chat route post-commit immediate dispatch。
- Dispatch：`src/lib/conversation-title/dispatch.ts:12-38` 原子把 `dispatchAfter` 推后 15 分钟，但把 id/user/conversation/first message/fallback/model 全量复制进 queue。
- Handler：`service.ts:148-177` missing/stale/manual rename no-op；`192-206` generation failure 抛稳定 error；`208-253` final transaction 再 fencing，成功更新或 no-op 后删除 matching job。
- Recovery：`dispatch.ts:40-65` 最多 25 条顺序重投；`67-99` 立即+60 秒 single-flight scheduler。

结论：三个领域都已有 durable/fencing contract，runtime 不应复制业务判断。Title queue full payload 是唯一明显的第二事实源与用户内容复制面，应收敛为 id-only。

## Existing Tests And Gaps

### Already Covered

- `src/lib/infra/queue.test.ts:75-177`：adapter cold singleton、constructor/start/create failure retry、send ordering、同名并发 create。
- `queue.test.ts:189-239`：work registration、handler reject/批次停止、readiness 等待 start。
- `queue.test.ts:241-293`：stop 后 restart、stop 中 send、stop 等待已进入 createQueue 的 send。
- `src/worker.test.ts:40-120`：正常注册/恢复顺序、两种 signal、逆序 shutdown。
- `worker.test.ts:122-205`：三个 handler failure propagation。
- `worker.test.ts:207-313`：env failure、部分 registration/startup rollback、recovery stop failure 继续 queue stop/exit 1。

### Missing

- 真实 pg-boss start failure 后必须构造新 instance；现有 mock 允许同 instance retry，掩盖第三方状态 poison。
- start pending 与 stop、stop failure、双 stop、stop 后 fresh generation 的完整交错。
- callback pending 时 stop 的真实 handler drain，以及 pg-boss timeout resolve 后 adapter 识别 failure。
- memory/title/file 显式 completed/noop outcome，而不只是 `undefined`。
- 每个 registration/recovery construction 阶段的反向 rollback 矩阵与多 cleanup failure。
- shutdown deferred 时三次 signal single-flight、queue.stop reject 与 drain timeout exit 1。
- raw pg-boss error、payload/id/user text/secret 不进入 logs 或 callback failure。
- 一个 generic scheduler 同时证明 immediate、interval single-flight、unref 与 stop active-round drain。

## Data And Build Impact

- `src/db/schema/pg.ts` 已具备 memory/title durable rows 与 file state/lease；本任务无 schema 缺口。
- queue names 保持不变，不调用 deleteQueue，不清理 pg-boss job。
- title 的旧 full payload 含 `id`，新 handler 可以读取；新 id-only payload 在旧 worker 下会失败但 outbox 保留，旧 recovery 到期后可重新发送，不丢 intent。
- `.trellis/spec/backend/database-guidelines.md:17-20` 要求 pg-boss 变量路径动态 import；`pnpm build` 是 Edge instrumentation gate。
- shared catalog 必须是纯类型/常量叶子，不能静态 import worker runtime/definitions/领域 handlers。

## Decisions And Rejected Alternatives

### Chosen: Adapter Singleton With Replaceable Generations

保留调用方稳定 API，同时使 constructor/start/stop failure 的 pg-boss instance 永不复用。比给现有 promise 状态加 mutex 更直接解决真实第三方状态污染。

### Chosen: Typed Catalog And Minimal Durable Identifier

queue name、payload、policy 与安全 failure message 必须同源。Title 业务数据只留在 durable outbox，queue transport 不再复制用户消息。

### Chosen: Runtime-Owned Generic Scheduler

三个 scheduler 已逐行重复 timer/single-flight/stop 逻辑。领域只应拥有一轮 scan；runtime 才是 timer 和 shutdown owner。

### Chosen: Explicit Handler Outcome

`undefined` 同时表示成功与 no-op，无法形成可靠日志与测试 contract。领域 adapter 返回 `completed|noop`，throw 唯一表示 retryable failure。

### Chosen: Fixed Queue Error Logs

pg-boss error 可能携带 SQL 参数、job id 或底层对象。通用 redactor 不能证明所有实体标识已移除，因此 queue event 与 recovery runtime 只输出固定 stage/name；安全 retry message 由 catalog 提供。

### Chosen: Monotonic Deadline Plus Handler Set

handler set 证明 callback 所有权，monotonic deadline 识别 pg-boss 超时后 resolve。两者缺一都会留下 false-success 窗口；deadline 边缘的保守失败优先于隐藏不完整关闭。

### Rejected: New Schema, DLQ Or Data Reset

现有 durable rows、lease 和 pg-boss finite retry 已足够完成核心生命周期。新增 schema/DLQ 会扩大产品与运维范围；清数据没有必要且不被本 child 授权。

## Applicable Specs

- `.trellis/spec/backend/database-guidelines.md`：pg-boss producer lifecycle、durable outbox、动态 import 与 readiness。
- `.trellis/spec/backend/file-storage.md`：file coordinator/lease/recovery/worker shutdown contract。
- `.trellis/spec/backend/chat-run-metadata.md`：memory intent 与 completion transaction 边界。
- `.trellis/spec/backend/error-handling.md`：raw infrastructure/provider error 不跨 queue/log 边界。
- `.trellis/spec/backend/logging-guidelines.md`：低基数字段、敏感信息与事实模型边界。
- `.trellis/spec/backend/directory-structure.md`：app/lib/infra/worker dependency direction。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`：producer -> queue -> handler -> durable DB -> recovery 数据流。
- `.trellis/spec/guides/code-reuse-thinking-guide.md`：三处重复 scheduler 与 name/policy 常量必须单一事实源。

## Remaining Risks

- 30 秒 drain timeout 可能中断长文件处理；pg-boss retry 与 file lease fencing 保证不会错误覆盖，但不能取消或回收已发生的外部计算成本。
- file error 在有限 queue retry 耗尽后不被 recovery 自动扫描，这是现有防无限重试策略，不在本任务改变。
- pg-boss 升级可能修改 start/stop 内部语义；锁定版本升级必须重新做源码核验和 generation/drain tests。
- stop 在第三方内部早期失败时，旧 instance 可能仍持有资源；worker 必须非零退出交给进程守护器，不尝试在同一进程复用未知状态对象。
