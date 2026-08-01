# Worker And Queue Lifecycle Implementation Plan

## Execution Rule

本计划只在用户审阅最新 planning summary 并另行批准后执行。实施采用一次性内部 API cutover，不保留裸 queue name overload、旧 recovery timer wrappers 或旧 worker cleanup tree。每阶段先补失败测试，再改生产代码；任一 gate 未满足即停在对应 rollback point。

## Phase 0: Baseline And Characterization

- [x] 运行 queue、worker、三个 recovery/handler、upload、chat completion/title route 与 readiness 定向测试，记录基线。
- [x] 补 characterization：三个现有 queue 的 name/payload、pg-boss 有效 retry/expiration 默认值、title full payload、worker shutdown order 与 handler failure propagation。
- [x] 增加安全断言：queue event、handler rejection、startup/shutdown 日志不得包含测试 payload、用户文本、id、PostgreSQL/provider URL、header、credential、cause 或 stack。
- Gate：外部 API/DB 行为与计划中故意改变的内部 queue payload、outcome return type、constructor count 被明确区分。
- Rollback point：只有测试与 fixtures，无产品行为变化。

## Phase 1: Typed Job Catalog And Explicit Outcomes

- [x] 新增 `src/lib/jobs/catalog.ts`，定义三个 `QueueDefinition`、最小 payload、稳定 retry message，以及显式 `retryLimit=2/retryDelay=0/retryBackoff=false/expireInSeconds=900`。
- [x] 把 queue adapter API 改为接收 definition；`createQueue` 与 `send` 都应用 definition policy，删除 string overload。
- [x] upload、memory dispatch、title dispatch 与 worker definitions 全部引用 catalog；生产代码审计不再散落三个 queue name 字面量。
- [x] file payload 删除 storagePath/mime；title payload 改为 `{ id }`，新增 id-only outbox loader/processor，queue 中不再复制首条消息或模型信息。
- [x] file/memory/title 领域 adapter 返回 `completed | noop`；保持原有 fenced writes、durable row 删除/保留和 retryable throw。
- [x] 删除三个 recovery round 日志中的 file/job/conversation id；逐项隔离继续执行，但 console 只记录稳定 recovery name/stage。
- Verify：catalog/producer、processing coordinator、memory jobs/extract、title service/dispatch、upload regressions。
- Gate：三个 handler 的 completed/noop/failure 矩阵完整；API response、durable rows、RAG 状态与 title fencing 不变。
- Rollback point：catalog 与领域 outcome 可在 runtime cutover 前由现有 worker adapter 暂时映射，尚未删除旧 scheduler。

## Phase 2: Replaceable Queue Generation

- [x] 重写 `src/lib/infra/queue.ts` 的内部生命周期为显式 generation state；adapter singleton 与 pg-boss instance lifetime 解耦。
- [x] generation 独占 named queue promises、active API operations 与 active handler promises；constructor/start/normal stop/stop failure 后一律丢弃实例。
- [x] start failure single-flight best-effort cleanup 且保留原错误；下一次 start/send 构造新 pg-boss。
- [x] stop 同步关闭旧代 admission，等待已登记 operation，再显式调用 `boss.stop({close:true,graceful:true,wait:true,timeout:30000})`。
- [x] callback wrapper 跟踪真实 handler，并注入 monotonic clock；boss.stop elapsed 跨过 30 秒或返回后仍有 active handler 时抛稳定 drain timeout error。
- [x] pg-boss error listener 只输出固定低基数安全消息，不拼接第三方 error；handler callback 只抛 catalog 稳定 retry message。
- [x] 新增隔离 PostgreSQL harness，使用锁定的 pg-boss 11.1.2 验证 deferred handler 在 deadline 前完成可 clean drain，以及超时后 job 进入 retry/failed 且 adapter 不报告成功；finally 关闭连接并删除随机临时库。
- Verify：queue lifecycle race/failure/drain table、真实 PostgreSQL clean-drain/timeout、readiness、Web producer cold start。
- Gate：并发 start/create/stop 都只有一个 owner；失败实例从不复用；stop resolution 可以区分正常 drain 与 timeout。
- Rollback point：queue 模块与 tests 为一个原子提交面；不涉及 schema，失败时整体回滚该模块。

## Phase 3: Generic Worker Runtime And Recovery Scheduler

- [x] 新增 `src/lib/worker/definitions.ts`，以 catalog 顺序绑定三个 handler 与三轮 recovery，不包含 signal/timer/cleanup 控制流。
- [x] 新增 `src/lib/worker/runtime.ts`，实现 lifecycle state、generic immediate/60s/unref/single-flight scheduler、registration、cleanup stack 与 signal single-flight。
- [x] 删除 `startFileProcessingRecovery`、`startMemoryExtractionRecovery`、`startConversationTitleRecovery`；领域模块只保留 recover round，scheduler tests 迁入 runtime。
- [x] startup rollback 参数化覆盖 queue start、每个 handler registration、每个 scheduler construction；cleanup failure 不覆盖原始错误且不阻断后续清理。
- [x] shutdown 参数化覆盖每个 scheduler stop、queue stop 与 drain timeout；重复 SIGINT/SIGTERM 在 deferred cleanup 中只触发一轮和一次 exit。
- [x] 把 `src/worker.ts` 收敛为变量路径加载与 runtime 组装；顶层 catch 不输出原始错误。
- Verify：runtime tests、worker entry tests、三个 recovery round tests、handler failure privacy tests。
- Gate：`worker.ts` 不含领域 name、payload、timer 或 cleanup branch；runtime 是唯一生命周期 owner。
- Rollback point：runtime/definitions/entry 作为一个 cutover 整体回滚；durable rows 与 queue names 无变化。

## Phase 4: Cross-Layer Recovery And Compatibility

- [x] memory immediate send failure、process restart 与 claim window 到期后重投测试继续通过。
- [x] title id-only dispatch 的 send failure、stale/replaced/manual rename fencing、recovery 重投与旧 full payload 含 id 的消费测试通过。
- [x] file upload queue failure fallback、pending/stale lease recovery、claim loser/lease loss no-op 与 retryable handler rejection继续通过。
- [x] readiness 证明 Web 进程可独立初始化 queue，但不声称 worker alive。
- [x] 审计 queue payload/log/failure output，不存在用户消息、storage path、完整 payload 或原始基础设施异常。
- Verify：upload、chat route/completion、title、memory、RAG、readiness 定向回归。
- Gate：queue transport acceptance 不删除 durable intent；进程退出前后的三条恢复路径均有测试证据。
- Rollback point：无数据迁移；代码回滚后 durable intent/lease 自行收敛，不清理业务或 pg-boss 数据。

## Phase 5: Full Verification And Spec Sync

- [x] 运行定向测试：

```bash
pnpm exec vitest run \
  src/lib/infra/queue.test.ts \
  src/lib/worker/runtime.test.ts \
  src/worker.test.ts \
  src/lib/rag/processing-coordinator.test.ts \
  src/lib/rag/processing-heartbeat.test.ts \
  src/lib/rag/recovery.test.ts \
  src/lib/memory/extract.test.ts \
  src/lib/memory/jobs.test.ts \
  src/lib/memory/dispatch.test.ts \
  src/lib/conversation-title/service.test.ts \
  src/lib/conversation-title/dispatch.test.ts \
  src/app/api/upload/route.test.ts \
  src/app/api/chat/route.test.ts \
  src/app/healthz/ready/route.test.ts
```

- [x] 运行真实 queue lifecycle gate：

```bash
pnpm exec tsx --env-file-if-exists=.env.local scripts/test-queue-lifecycle-pg.ts
```

- [x] 运行 `pnpm lint`、`pnpm typecheck`、全量 `pnpm test` 与 `pnpm build`。
- [x] 运行 `git diff --check`、Trellis validate，以及 queue name/payload/raw log/dynamic import/schema/migration `rg` 审计。
- [x] 独立复核 generation transition、JS admission linearization、pg-boss 11.1.2 stop timeout、handler set、startup rollback、signal single-flight、privacy 与 durable recovery。
- [x] 更新 `.trellis/spec/backend/queue-lifecycle.md`、`database-guidelines.md`、`file-storage.md`、`error-handling.md`、`logging-guidelines.md`、`directory-structure.md`；只记录实现后验证的最终 contract。
- Gate：定向、lint、typecheck、全量 tests、build、spec、Trellis validate 与独立 review 全部通过。

## Risk Register

| Risk | Mitigation / Gate |
|---|---|
| pg-boss start 失败实例被误复用 | generation constructor-count test；任何 start/stop failure 后强制新实例 |
| stop 与 operation/handler 交错丢 drain | 同步 state/identity admission；deferred start/send/work/handler race tests |
| pg-boss timeout 后 handler 恰好完成，被误报成功 | monotonic deadline + active handler set；mock late-completion race + 真实 PG 状态 gate |
| title minimal payload 破坏业务恢复 | outbox id loader、send failure/restart tests；queue acceptance 不删 row |
| outcome 改型误改 RAG/memory/title行为 | 三领域 completed/noop/failure characterization；状态/row/fencing 断言 |
| generic scheduler 改变立即扫描语义 | immediate microtask、60s、single-flight、unref、stop drain fake-timer tests |
| queue error/log 泄露 payload、id 或凭据 | adversarial secret fixtures；第三方 error 不进入 console；callback 只用 catalog 稳定消息 |
| catalog 被 Web import 时拖入 Node graph | catalog 纯类型/常量；变量路径 driver import；`pnpm build` |
| 意外 schema 或 queue 数据变动 | no-migration/no-reset gate；schema/drizzle diff 审计；不调用 deleteQueue |
| memory intent 重复 delivery 触发重复外部写入 | 明确维持 at-least-once；现有 mem0 推断/去重只降低影响，不声称 exactly-once；消费端 fencing 作为后续独立设计 |

## Pre-Start Review Checklist

- [x] 用户已审阅本轮最新 planning summary，并在后续消息明确批准实施。
- [x] `prd.md`、`design.md`、`implement.md`、`research/evidence.md` 与两个 context manifests 通过 Trellis validate。
- [x] 显式 retry policy 仅钉住当前有效默认，不改变重试次数或 expiration。
- [x] drain timeout 固定 30 秒且 timeout 非零退出，无隐藏成功路径。
- [x] 不新增 schema/migration，不清理业务或 pg-boss 数据。
- [x] title id-only payload 的协调 cutover 与 durable rollback 路径已被接受。

## Verification Record

- `pnpm lint`：零 warning/error。
- `pnpm typecheck`：通过。
- `pnpm test`：113 files passed、2 skipped；942 tests passed、17 skipped。
- `pnpm build`：Next.js production build 与 Edge instrumentation 编译通过。
- 真实 PostgreSQL/pg-boss gate：clean drain completed；30 秒 timeout 返回稳定 failure，job 为 `retry|failed`；临时数据库残留为 0。
- `git diff --check`、Trellis validate、queue/log/schema/migration 审计通过；`src/db` 与 `drizzle/pg` 无 diff。
