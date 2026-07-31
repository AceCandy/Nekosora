# Architecture Roadmap Evidence

> `Completed Baseline` 至 `Chat Composer` 记录的是各 child 创建前的规划基线，不代表当前实现。收敛后的代码事实与验证结果见文末 `Final Integration Evidence`。

## Completed Baseline

- Commit `beaeb6f`: unified Gateway execution engine and observability.
- Archived task: `.trellis/tasks/archive/2026-07/07-29-gateway-execution-engine/`.
- Stable boundary: `src/lib/gateway-execution/`; Chat and media adapters consume it.

## Chat Completion

- `src/app/api/chat/route.ts:436-755` currently owns ReadableStream control, heartbeat, event forwarding, message persistence, artifact extraction, memory enqueue, run finalization and terminal SSE.
- `src/app/api/chat/route.ts:742-755` already protects `[DONE]` behind required persistence, but orchestration remains route-local rather than an independent contract module.
- `src/lib/chat/run-lifecycle.ts` owns run/tool persistence primitives; it must remain separate from gateway execution telemetry.
- `src/app/api/chat/route.ts:683-700` sends `memory-extract` directly and records queue failure only to console; durable delivery intent is not represented.

## RAG Processing

- `src/lib/rag/process.ts:31-100` combines claim, lease token, heartbeat and stage mutation.
- `src/lib/rag/process.ts:169-202` combines chunk replacement, final state and lease-loss handling.
- `src/lib/rag/recovery.ts:11-80` separately owns stale scanning and scheduler lifecycle.
- Existing tests: `process.test.ts`, `process.pg.test.ts`, `recovery.test.ts`; they are characterization gates, not a reason to retain the current boundary.

## Worker / Queue

- `src/lib/infra/queue.ts:55-139` owns start/stop, active operations and lazy queue creation.
- `src/worker.ts:16-123` separately owns job registration, two recovery schedulers, signal shutdown and startup rollback.
- Existing `queue.test.ts` and `worker.test.ts` protect start/stop races and reverse shutdown ordering.

## Model Catalog

- `src/lib/sync-pi-models.ts:310-323` casts external `thinkingLevelMap` without full semantic validation.
- `src/lib/sync-pi-models.ts:325-333` keeps old reasoning/vision on upstream downgrade.
- `src/lib/sync-pi-models.ts:645-650` falls back only the map when invariants fail, leaving related fields potentially inconsistent.
- Project rule: `model_catalog` is the only fact source; official model semantics take precedence, while pi may inform compatible thinking formats/maps.

## Chat Composer

- `src/features/chat/components/ChatComposer.tsx:104-112` stores related selection fields independently.
- `src/features/chat/components/ChatComposer.tsx:264-289` persists a combined snapshot from two independent state updaters; each updater captures the other field from render state.
- Rapid card/KB toggles and async response reordering can persist a snapshot older than the latest visible selection.

## Historical Decision

- The user accepts high-risk/high-reward refactoring and requested implementation in recommended order.
- Earlier architecture exploration identified RAG lease, worker lifecycle and catalog sync as high-value candidates.
- The completed Gateway task explicitly deferred Chat message/run/SSE transaction work; repository evidence now places it first because it protects user-visible completion and supplies a durable intent contract consumed by the later worker lifecycle task.

## Final Integration Evidence

### Archived Deliverables

- Chat completion、RAG processing、worker/queue、model catalog sync 与 Chat Composer 五个 child 均已归档到 `.trellis/tasks/archive/2026-07/`，父任务 children 为 5/5。

### Cross-Module Contracts

- Gateway execution 只拥有 route/key attempts、commit latch、breaker 与 execution telemetry；`completion-coordinator` 持有 Chat 首终态，`completion-repository` 同事务写 assistant、conversation 时间、memory durable intent 与 run 终态，route 只编码 SSE。
- memory intent 与 conversation title 使用 durable row + claim + queue dispatch；worker runtime 统一注册三类 job、启动 recovery scheduler、反向停止 scheduler、等待 queue handler drain 并 single-flight 处理 signal shutdown。
- RAG `processing-repository` 使用数据库时钟、lease token、状态谓词和 statement-time fencing；chunk replacement 与终态在同一事务内完成，旧 owner 不能在失去租约后提交。
- `model_catalog.capabilities` 由 sync planner/migration 维护，经 model join 进入 Chat option 与 resolved route；UI 档位、Composer clamp、routing 和 provider request translation 共用 `lib/reasoning.ts`，未发现按模型名复制能力判断。
- Composer 的同步 machine snapshot、latest-only writer、create/adopt 与 conversation key fencing 不进入 Chat stream store，也不改变 completion transaction 或公开 `/v1/*` wire contract。

### Security Finding And Fix

- 集成审计发现 `rag/retrieve.ts` 与 `chat/orchestrator.ts` 将原始 `Error` 交给 console，且共享 `redactErrorMessage` 未移除 provider/PostgreSQL URL。修复后错误边界统一移除基础设施 URL，两个降级日志只记录脱敏字符串；业务返回与 fallback 控制流不变。

### Validation

- lint、typecheck、production build 通过；全量 Vitest：117 个文件通过、2 个跳过，981 个用例通过、17 个跳过。
- RAG lease PostgreSQL：14/14；queue lifecycle：clean drain 与 timeout；Chat completion transaction：3/3。随机临时数据库最终残留计数为 0。
- 浏览器认证后桌面/390px Chat 交互未验证；未读取或创建本地凭据。
- 失败/中断 SSE 不补 `[DONE]` 是现有测试锁定的协议选择，作为客户端兼容风险保留，不在最终集成中静默改 wire behavior。
