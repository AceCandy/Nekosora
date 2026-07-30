# RAG File Processing State Machine Implementation Plan

## Execution Rule

本计划只在用户审阅最新 planning summary 并另行批准后执行。实现不保留旧 `process.ts` wrapper 或双 coordinator；现有 queue envelope 保持单一兼容格式。每阶段先写失败测试，再改生产代码，任一 gate 未满足即停在对应 rollback point。

## Phase 0: Baseline And Characterization

- [x] 运行现有 process、heartbeat、recovery、upload、worker、queue、retrieve/context、knowledge-base、schema/migration 定向测试，记录基线。
- [x] 补 caller characterization：上传成功 body/status 不变、queue/fallback 只影响后台处理、worker handler failure 必须 reject。
- [x] 补状态 characterization：unsupported、empty、embedding unavailable/failure 的现有 `done/rag_ready/rag_reason` 与文本 chunks 行为。
- [x] 补安全失败测试：DB stable code/安全 `embed_error`、coordinator fixed rejection/no cause、worker rejection、recovery log、upload queue dispatch 与 fallback log 分别断言原始 token/query credential、PostgreSQL URL、provider URL 与 storage path 不泄露且长度有界。
- Gate：测试锁定必须保留的外部行为，并对将故意改变的内部三参数入口和 retryable failure propagation 明确标红。
- Rollback point：仅测试和 fixtures，无产品行为变化。

## Phase 1: State Contract And Lease Repository

- [x] 新增 `src/lib/rag/processing-state.ts`，定义 primary states、transition commands、stable reason/failure codes、lease-lost/retryable errors 与统一安全错误 formatter。
- [x] 用穷尽 switch 为每个 command 固定 expected active state、DB patch 与 terminal/lease-clear 语义；非法 transition 测试必须失败。
- [x] 新增 `src/lib/rag/processing-repository.ts`，集中 recoverable scan、claim、renew、owned transition、owned failure 和 chunk replacement transaction。
- [x] claim 只接收 fileId，并在同一 `UPDATE ... RETURNING` 返回 token、storagePath、mime；所有 clock expression 保持数据库端。
- [x] repository 不导出任意 patch/write escape hatch；生产代码只有此模块能写 processing lease/state 与替换 chunks。
- [x] 将 recovery candidate query 迁入 repository，但暂不切 production scheduler。
- Verify：state exhaustive tests、repository mocked-DB contract tests、现有 migration/index tests。
- Gate：所有 owned predicate 与 chunk transaction 只有一个实现；删除 repository 会让 direct/recovery contract tests 同时失败。
- Rollback point：新模块尚未接生产入口，旧 `process.ts` 仍运行。

## Phase 2: Coordinator And Heartbeat

- [x] 新增 `src/lib/rag/processing-coordinator.ts`，以 repository claim 返回的 canonical metadata 执行 extract -> chunk -> embed -> persist。
- [x] 把 heartbeat 迁入 coordinator：30 秒、unref、single-flight、zero-row/reject 均 lease lost、所有出口 clear + await in-flight。
- [x] 通过 transition commands 写 extraction/embedding sub-status；coordinator 不直接 import Drizzle/schema。
- [x] 保持 unsupported/empty terminal 与 embedding degraded completion；`rag_reason` 只写 stable code，`embed_error` 只写安全短消息。
- [x] extraction/storage-read/chunking/persistence failure 先尝试 owned error terminal，再抛固定 retryable generic error；lease loss resolve no-op。
- [x] 覆盖每个阶段 lease loss、heartbeat reject、晚到 embed result、error write loss 和 error write DB failure。
- [x] 覆盖 retryable failure 后同一 queue job/内部调用可重新 claim `error`，同时 recovery scanner 继续排除 `error`。
- Verify：coordinator/state/heartbeat unit tests。
- Gate：coordinator 测试不需要真实 DB；repository 测试不调用 extract/embed，职责边界清晰。
- Rollback point：新 coordinator 可独立测试，生产入口尚未切换。

## Phase 3: Destructive Cutover

- [x] upload 保持现有 `{fileId,storagePath,mime}` queue envelope 以兼容旧 worker，fallback 改为 `processFile(fileId)`；queue/fallback 日志使用统一安全 formatter，HTTP response 不变。
- [x] worker `file-process` handler 保持现有 envelope type，但只把 fileId 传给 coordinator；retryable generic error 原样 reject 给 queue adapter，并断言 message 固定、无 cause。
- [x] recovery 使用 repository candidate ids + coordinator；保持顺序隔离、limit、single-flight、interval 与 stop drain。
- [x] 更新/重命名 process、heartbeat、PG tests 的 imports，使其指向 state/repository/coordinator。
- [x] 删除 `src/lib/rag/process.ts`，删除旧三参数调用和 recovery 内重复 candidate/lease SQL，不保留 re-export 或 compatibility branch。
- [x] 运行 `rg` 审计所有 processing state/lease/chunk writers、旧 import 和 queue payload，确认没有第二入口。
- Verify：upload、worker、queue、recovery、context/retrieve、knowledge-base regressions。
- Gate：生产调用图只有 fileId-only coordinator，queue 只有一个向前/向后兼容 envelope；上传外部契约与检索结果不变。
- Rollback point：代码作为同一 cutover 提交整体回滚；积压 queue job 仍可由旧 worker 消费，无 schema rollback。

## Phase 4: PostgreSQL Concurrency Proof

- [x] 保留并迁移现有 expired takeover、fresh rejection、concurrent single winner、row-lock predicate recheck、old-token rejection、insert rollback 与 statement-time rollback cases。
- [x] 新增 old-owner late embedding case：owner A 进入 deferred embedding，DB lease 过期后 owner B claim 并完成，A 晚返回后不能写 embed status、chunks、error 或 terminal。
- [x] 增加 chunk transaction 锁等待跨过 lease expiry 的锁后 freshness 回归。
- [x] 增加 stable `(created_at,id)` tie ordering 与第二轮继续处理第 26 条的 recovery 断言。
- [x] 通过现有安全 harness 创建随机固定前缀临时库、安装 vector、跑全迁移；`finally` 关闭 pool、终止该库连接并强制删除，禁止打印 URL。
- Verify：

```bash
pnpm exec tsx --env-file-if-exists=.env.local scripts/test-file-processing-lease-pg.ts
```

- Gate：真实 PostgreSQL 证明旧 owner 无法覆盖新 owner，chunk replacement 在所有失败点保持原子。
- Rollback point：若 PG gate 失败，回到 repository/coordinator 修复，不用 mock 断言替代。

## Phase 5: Full Verification And Spec Sync

- [x] 定向测试：

```bash
pnpm test -- \
  src/lib/rag/processing-state.test.ts \
  src/lib/rag/processing-repository.test.ts \
  src/lib/rag/processing-coordinator.test.ts \
  src/lib/rag/processing-heartbeat.test.ts \
  src/lib/rag/recovery.test.ts \
  src/app/api/upload/route.test.ts \
  src/worker.test.ts \
  src/lib/rag/retrieve.test.ts \
  src/lib/rag/context.test.ts \
  src/lib/knowledge-base/service.test.ts
```

- [x] 运行 `pnpm lint`、`pnpm typecheck`、全量 `pnpm test`、`pnpm build`。
- [x] 运行 Trellis validate、`git diff --check` 和 writer/import/payload `rg` 审计。
- [x] 独立复核 state exhaustiveness、DB clock/token predicates、heartbeat race、late owner、chunk atomicity、error privacy、upload wire 与 worker rejection。
- [x] 更新 `.trellis/spec/backend/file-storage.md` 的文件处理 contract，并在需要时同步 `database-guidelines.md`、`error-handling.md`、`logging-guidelines.md`；只记录实现后已验证的事实。
- Gate：定向、隔离 PG、lint、typecheck、全量 tests、build、spec 和独立 review 全部通过。

## Risk Register

| Risk | Mitigation / Gate |
|---|---|
| 冗余 queue metadata 被误当事实源 | coordinator API 只接 fileId；claim RETURNING canonical metadata；worker test 断言不转发 path/mime |
| repository 抽取时漏掉一个直接 writer | Phase 1/3 全仓 writer audit；禁止通用 patch escape hatch；删除旧 module 后 `rg` gate |
| heartbeat reject 与外部晚结果竞态 | repository 条件写是最终事实；每阶段与 chunk transaction tests；真实 late-owner PG case |
| chunk transaction 中 lease 到期 | 最终 `statement_timestamp()` gate，失败整事务回滚并保留旧 chunks |
| retryable error 写失败或已失租 | 已失租不写 error；DB failure 只抛通用 retryable error，不泄露原始异常 |
| embedding 瞬时失败不自动恢复 | 保持当前 degraded terminal；文本 chunks 可 full-context；有界 retry 留给后续 lifecycle/product task |
| 任务误引入 schema/data churn | 明确 no-migration gate；schema/journal/snapshot diff 必须为空 |

## Pre-Start Review Checklist

- [x] 代码证据与 R8 已决定 embedding failure 保持 degraded terminal；通用 retry policy 留给 Worker/queue lifecycle。
- [x] 现有 schema 足够，本任务明确不清理 RAG 数据、不新增迁移。
- [x] queue envelope 保持兼容，回滚无需转换或清空积压 job；旧三参数 processing wrapper 仍删除。
- [x] `prd.md`、`design.md`、`implement.md`、`research/evidence.md` 和两个 context manifests 通过最终 Trellis validate 与独立复核。
- [x] 用户明确批准本轮最新 planning summary；随后才执行 `task.py start`。
