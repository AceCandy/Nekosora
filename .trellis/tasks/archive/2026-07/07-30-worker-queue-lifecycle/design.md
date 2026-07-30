# Worker And Queue Lifecycle Design

## 1. Problem Restatement

后台任务的领域幂等与 durable intent 已经存在，但进程生命周期仍由 `queue.ts` 与 `worker.ts` 共同拼装。核心问题不是缺少更多 catch，而是没有一个边界同时拥有：job contract、pg-boss instance generation、operation admission、真实 handler drain、recovery timer 和 signal shutdown。

本设计进行一次破坏性内部统一，不增加中间兼容层，也不改变 schema 或业务算法。

## 2. Target Modules

### `src/lib/jobs/catalog.ts`

纯数据/类型模块，作为 Web producer 与 worker definition 的共享事实源。它只依赖 type-only queue contract，不导入 pg-boss、worker runtime 或领域 service，因此可安全进入 Next bundle。

每个 `QueueDefinition<TPayload>` 固定：

- queue name；
- payload type；
- `retryLimit`、`retryDelay`、`retryBackoff`、`expireInSeconds`；
- queue callback 可公开的稳定 retry error message。

三个 definition 使用当前 pg-boss 11.1.2 的有效默认值：两次 retry、零延迟、无 backoff、900 秒 expiration。`createQueue` 与每次 `send` 都使用同一份 policy；即使既有 queue row 保留旧配置，新 job 的 send options 仍以 catalog 为准。

### `src/lib/infra/queue.ts`

保留 `getQueue()` 单例入口，但 singleton 只代表 adapter，不再代表永久 pg-boss 实例。adapter 内部拥有一个可替换 generation，并导出类型化的 `start/stop/send/work` contract。

### `src/lib/worker/definitions.ts`

唯一领域装配点。把 catalog definition 绑定到：

- 返回 `completed | noop` 的 handler adapter；
- 一轮 recovery 函数；
- recovery 的稳定 scan failure message。

该模块可以导入领域 service，但只能被 worker runtime 的变量路径入口加载。

### `src/lib/worker/runtime.ts`

拥有 worker lifecycle、generic recovery scheduler、registration、startup rollback、signal single-flight 与 cleanup result。它依赖注入 queue、definitions、timer/runtime/logger ports，测试不启动真实进程。

### `src/worker.ts`

只保留 Node worker entry：变量路径加载 env、queue、definitions/runtime，构造 runtime 并启动；顶层失败只输出稳定消息并非零退出。

## 3. Core Contracts

```typescript
export type JobOutcome = "completed" | "noop";

export interface QueueDefinition<TPayload> {
  name: string;
  policy: {
    retryLimit: number;
    retryDelay: number;
    retryBackoff: boolean;
    expireInSeconds: number;
  };
  retryMessage: string;
}

export interface WorkerDefinition<TPayload> {
  job: QueueDefinition<TPayload>;
  handle(payload: TPayload): Promise<JobOutcome>;
  recovery: {
    intervalMs: number;
    run(): Promise<void>;
    failureMessage: string;
  };
}
```

`QueueAdapter.send/work` 接收 definition 而不是裸 name。删除 string overload，迫使 producer、handler registration 与 retry policy 共享同一个 compile-time contract。

## 4. Queue Generation State Machine

### States

```text
idle -> starting -> running -> stopping -> idle
          |            |          |
          +--failure---+----------+
```

每个 generation 独占：

- 一个 pg-boss instance；
- start/close single-flight promise；
- named queue creation promises；
- active send/work registration operations；
- active business handler promises。

### Start

1. `running/starting` 返回当前 generation 的 ready promise。
2. `stopping` 等待旧 generation close 后重新进入 start。
3. `idle` 构造新 pg-boss、安装固定安全消息的 error listener，并只发布一个 starting generation。
4. start 成功且 generation 仍是当前对象时进入 running。
5. constructor/start 失败时 single-flight best-effort close，丢弃 generation，再以原始调用错误拒绝；下一次 start 必须重新构造 pg-boss。

重新构造是必要约束：pg-boss 11.1.2 在内部 start 失败时保留 `#starting=true`，复用实例会产生伪成功。

### Operation Admission

`send/work` 循环等待 running generation，然后在同一个同步 turn 内检查 generation identity 并登记 operation。stop 先同步把 state 改为 stopping；因此之后的调用只能等待下一代，之前已登记的 operation 属于旧代 drain 集合。

现有“检查 stop 后登记”之间没有 `await`，并不存在另一个 microtask 可插入的窗口。重构使用显式 state/identity 是为了让这条线性化规则可读、可测，而不是修复一个虚构 race。

### Named Queue And Policy

同名 `createQueue` 在 generation 内复用一个 Promise，失败只移除自己的 entry。正常 stop 后整个 map 随 generation 丢弃；下一代会重新确认 queue 存在。

`createQueue(name, policy)` 对已有 row 是幂等 no-op，因此 `send` 还必须显式传入同一 policy，保证既有 queue 配置不能改变新 job 的有限 retry/expiration。

### Stop And Handler Drain

1. state 同步进入 stopping，阻止旧代接纳新 API operation；重复 stop 返回同一 Promise。
2. 等待该代已经登记的 send/work registration 全部 settled。
3. 调用 `boss.stop({ close: true, graceful: true, wait: true, timeout: 30_000 })`。
4. stop 前记录 monotonic deadline。pg-boss 返回后，只在 elapsed `< 30_000` 且 generation active handler set 为空时成功。
5. elapsed 已跨 deadline 或 handler set 非空时，adapter 抛稳定 drain timeout error。deadline 检查覆盖“pg-boss 超时后 failWip 期间 handler 恰好完成并清空 set”的窗口；接近 deadline 的正常完成可能被保守判失败，这是可接受的 shutdown safety 取舍。
6. 无论 stop 成功或失败都丢弃该 generation；后续 start 构造新实例。

adapter 不自行调用 pg-boss private worker/offWork API，也不复制 ack/retry SQL。monotonic deadline 与真实 handler set 共同把 pg-boss 无法区分的“正常 drain”与“超时后 resolve”转换为可靠的进程结果。

## 5. Job Payload And Outcome Cutover

### Payloads

| Job | New payload | Durable fact source |
|---|---|---|
| `file-process` | `{ fileId }` | `file_objects` row + lease |
| `memory-extract` | `{ id }` | `memory_extraction_jobs` |
| `conversation-title` | `{ id }` | `conversation_title_jobs` |

Upload 不再发送 storage path/mime；file coordinator 已从 claim 返回 canonical metadata。Title dispatcher 不再复制首条消息、fallback 或模型选择；新增 id-only service adapter 读取当前 outbox row，再调用现有 fenced title generation。

旧 title payload 本身含 `id`，可由新 handler 消费；新 id-only payload 无法由旧 worker 完成，但 durable outbox 不在 queue acceptance 时删除，回滚到旧代码后仍会在 claim window 到期时重投完整旧 payload，不丢失业务 intent。

### Outcomes

- file coordinator：claim/lease loss 为 `noop`；unsupported、empty、degraded 或正常持久化为 `completed`；现有 retryable failure 继续 throw。
- memory：missing durable row 为 `noop`；rate-limit/输入不足从 extraction service 传播 `noop`，删除 intent 后返回；写入完成为 `completed`；失败保留 row 并 throw。
- title：missing/stale/replaced/manual rename 为 `noop`；最终条件更新成功为 `completed`；生成或 persistence failure throw。

runtime 只允许这两个 resolve outcome。任意 throw 都转换成 definition 的新通用 Error，不附 cause；pg-boss 因此只能保存安全消息。领域边界仍负责必要的脱敏诊断，runtime 不记录 payload 或 id。

## 6. Recovery Scheduler Ownership

领域模块删除三个重复的 `start*Recovery` timer wrapper，只导出一轮 `recover*` 函数。runtime 对每个 definition 创建 scheduler：

1. start 后通过 microtask 立即触发一轮，不阻塞 worker ready；
2. 使用 60 秒 unref interval；
3. active round 未结束时跳过 tick；
4. round rejection 记录 definition 的稳定 failure message，不终止 scheduler；
5. stop 先设置 stopped，再清 timer，并等待当前 round settled。

runtime 保存 scheduler stop controller，并严格按创建逆序清理。单项 recovery 失败继续由领域 round 内既有隔离逻辑处理。

## 7. Worker Startup And Shutdown

### Startup

```text
validate env
  -> queue.start
  -> register all definitions in catalog order
  -> start all recovery schedulers
  -> install SIGINT/SIGTERM handlers
  -> running
```

每个成功创建的 scheduler controller 压入 cleanup stack。任一 registration/scheduler construction 失败时：

1. state 进入 stopping；
2. 逆序执行已有 scheduler stop，失败只记录稳定 stage/name；
3. 执行 queue stop/drain；
4. 抛回最初 startup error，不用 cleanup error 替换它。

### Signal Shutdown

SIGINT/SIGTERM 共用 `shutdownPromise`。第一次调用同步把 runtime 标为 stopping，后续调用直接返回相同 Promise。cleanup 收集所有失败而不短路：

```text
reverse recovery stop/drain
  -> queue generation graceful stop/handler drain
  -> exit(any failure ? 1 : 0) exactly once
```

queue drain timeout、queue stop reject 或任一 scheduler stop reject 都是 incomplete shutdown。日志只显示稳定资源名与阶段，不打印异常对象。

## 8. Error And Logging Boundary

- pg-boss `error` event 只输出固定低基数消息，不拼接原始 error。第三方错误可能包含 SQL 参数或实体 id，通用 URL/secret redaction 不能证明它们已移除。
- handler terminal log 字段限定为 job name 与 `completed|noop|retryable_failure`。
- startup/shutdown log 字段限定为 lifecycle stage、definition name 与成功/失败，不含 payload/id。
- 三个 recovery round 的逐项 failure log 删除 file/job/conversation id，只保留 recovery definition 与稳定 failure stage；领域安全诊断继续写入其已有受控状态字段。
- top-level worker catch 不输出 error/cause/stack。
- queue callback rejection 只使用 catalog 的稳定 retry message。

## 9. Build And Layer Boundary

- `catalog.ts` 是 Web/worker 共享叶子模块，不导入 Node driver或业务 handler。
- `queue.ts` 继续用变量字符串 `import("pg-boss")`。
- `worker.ts` 用变量路径加载 queue、definitions 与 runtime；Next instrumentation 不静态到达 worker graph。
- `src/lib/infra` 不 import 领域模块；worker definitions 依赖 infra 和领域，方向保持 `worker orchestration -> lib domain -> infra`。
- `pnpm build` 是不可跳过的 Edge gate。

## 10. Compatibility And Data Impact

- queue name 不变，pg-boss schema/table 不迁移，不删除积压 job。
- public Drizzle schema、journal、snapshot 与业务数据无变化。
- memory/title 的 15 分钟 durable claim 和 file lease/recovery selection 不变。
- retry/expiration 数值钉住当前有效默认，避免架构 cutover 同时改变运行时策略。
- 本次是同一提交的内部 API cutover；不保留裸 string overload、旧 scheduler wrappers 或旧 worker shutdown tree。

## 11. Rejected Alternatives

### Keep One PgBoss Instance And Clear Promises

拒绝。pg-boss 11.1.2 start failure 会把实例留在 `#starting`，adapter promise 可重试并不代表底层实例可重试。

### Add A Mutex Around Existing Functions

拒绝。mutex 只能串行 API call，不能表达 generation replacement、handler drain timeout、typed definitions 或 recovery ownership；会保留两个生命周期所有者。

### Trust `boss.stop()` Resolution As Successful Drain

拒绝。pg-boss 在 graceful timeout 后执行 failWip 并 resolve，调用方无法仅凭 Promise 结果区分正常 drain 与超时。

### Call PgBoss Private Worker APIs

拒绝。`offWork()` 本身不等待 worker stopped，且会复制第三方内部 polling/ack 语义。adapter 只使用公开 stop contract并跟踪自己的 callback promises。

### Keep Full Title Payload For Compatibility

拒绝。完整用户首条消息和模型上下文已在 durable outbox；复制到 pg-boss 扩大隐私面并制造第二事实源。当前尚未上线，且 outbox 可保证代码回滚后的最终恢复。

### Add Configurable Shutdown/Retry Environment Variables

拒绝。当前没有运维需求或多 profile 证据。固定并测试现有有效 policy 更简单；未来需要调整时由 catalog 单点演进。

## 12. Known Risks

- 30 秒内未完成的 handler 会被 pg-boss 转成 retry/failed，随后 worker 非零退出；外部 API 本身不可取消，进程退出会终止其本地执行。领域 fencing/durable row 防止错误提交或 intent 丢失。
- `file-process` 在 pg-boss 有限 retry 耗尽后仍保持业务 `error`，现有 recovery 明确不扫描 error；本任务保留该有界行为，不引入无限自动重试。
- pg-boss stop 自身在 manager stop 前失败时可能遗留旧实例资源；adapter 会 poison/discard generation，worker shutdown 非零退出，进程守护器必须重启进程。不能在同一进程安全复用未知状态实例。
- 新 id-only title producer 与旧 worker 不具备即时双向兼容；协调 cutover/回滚期间 durable outbox 会保留 intent，并在旧 recovery 到期后重新投递。
- unit test 可证明 adapter 对 callback set 的判断，但 pg-boss WIP/SQL 状态仍依赖锁定版本 11.1.2；升级 pg-boss 必须重新核对 stop/start 源码语义。
- deadline 是保守判定：handler 在 30 秒边缘完成、但 pg-boss cleanup 使总时长越界时仍非零退出。该误报优先于把 failWip 后的 late completion 当作成功关闭。
