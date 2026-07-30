# Chat Completion Transaction Boundary Implementation Plan

## Execution Rule

本计划只在用户审阅本轮最终 planning summary 并另行批准后执行。实现中不保留新旧 completion 双轨；每一阶段先补测试，再替换入口，阶段 gate 失败即停在当前 rollback point。

## Phase 0: Baseline And Characterization

- [ ] 运行现有定向基线：route、run lifecycle、stream Agent loop、SSE parser、memory、title dispatch、worker、queue、schema tests。
- [ ] 补 route characterization：identity/context/delta/reasoning/tool/error/finish 现有字段，send/retry/edit/continue 的 message/runId 归属。
- [ ] 补 cancel characterization：request Abort、reader cancel、setup 中 cancel 后上游 signal 与 controller 零后续写。
- [ ] 补 Agent characterization：多轮同 runId、唯一外层 finish、telemetry 聚合一次。
- Gate：测试能在未重构代码上描述保留契约，并明确标出将被故意收紧的旧行为。
- Rollback point：仅测试，无产品行为变化。

## Phase 1: Schema And Memory Job Contract

- [ ] 新增 `memory_extraction_jobs` Drizzle schema，包含 run/conversation/user cascade FK、run 唯一约束、dispatch 索引和最小 JSONB snapshot。
- [ ] 生成一条 forward PostgreSQL migration，同步 `_journal.json` 与 snapshot；不改写现有 migration。
- [ ] 实现 snapshot 规范化、job row DTO、按 id fencing 的读取/删除。
- [ ] 实现条件 dispatch claim、即时 dispatch、limit 25 recovery、60 秒 single-flight scheduler 和等待在途的 stop。
- [ ] 将 memory 核心 provider/add failure 改为 retryable generic error；明确 no-op 与 cache 派生失败保持可区分。
- [ ] worker 最小接线改为消费 intent id，并启动/停止 memory recovery；不在本阶段重构通用 worker lifecycle。
- Verify：schema/migration tests、memory service/dispatch/recovery tests、worker handler rejection/no-op tests。
- Gate：commit 后进程退出、queue send 失败、worker 恢复均不会丢 intent；失败不删 row。
- Rollback point：新表可保留未使用；尚未切 Chat producer。

## Phase 2: Strict Run And Completion Repository

- [ ] 新增 strict run start，生成前未确认 run 时抛 domain error且不调用上游；heartbeat 保持条件写与单飞。
- [ ] 实现 completion repository，在 conversation-first 短事务中复核 parent/source/continue version。
- [ ] 同事务插入/更新 assistant、更新 conversation 时间、写可选 memory intent、条件终结 run，并要求 terminal update `RETURNING` 一行。
- [ ] 返回一次计算的 status/tokenUsage/duration/completedAt；事务外不再二次构造 metadata。
- [ ] 覆盖消息失败、continue CAS miss、intent insert 失败、run zero-row、commit reject 的全回滚矩阵。
- [ ] 增加真实 PostgreSQL concurrency test：并发 continue 只有一方成功，失败方不能留下 run success 或 intent。
- Verify：repository unit + `TEST_DATABASE_URL` PostgreSQL integration tests。
- Gate：所有成功核心事实同 commit；任一失败均无半提交，也没有可发 success 的结果。
- Rollback point：repository 尚未接 route，旧路径仍运行。

## Phase 3: Completion Coordinator

- [ ] 实现明确 state/outcome 类型和 first-terminal-cause latch，禁止布尔值组合重新解释顺序。
- [ ] coordinator 内选择 plain/Agent stream，fold text/reasoning/tool/error/usage，拥有 tool audit 与 heartbeat cleanup。
- [ ] `streamChatWithTools` 最终 finish 使用各轮聚合 usage，同时保持一个 execution finalize 和一个外层 finish。
- [ ] coordinator 只在 strict repository 返回 committed success 后产生 success terminal；failed/interrupted 不产生 finish。
- [ ] artifact 迁到显式有界 post-commit best-effort hook，结果不参与核心 outcome。
- [ ] 覆盖 finish→Abort、Abort→finish、error→late finish、unexpected EOF、commit 中 cancel、重复 terminal event。
- Verify：coordinator state-machine unit tests、Agent loop tests、redaction tests。
- Gate：一个 run 只收敛一次，且 terminal 原因、DB status、客户端信号一致。
- Rollback point：coordinator 可独立测试，route 尚未切换。

## Phase 4: Route Cutover

- [ ] route 保留 auth/body/preparation 与 SSE adapter，接入 coordinator domain events。
- [ ] adapter 对 committed success 固定写一组 finish + `[DONE]`；error/interrupted/cancel 路径遵守零成功信号与取消后零 controller 写。
- [ ] 删除 route 内 heartbeat、事件聚合、消息事务、artifact/memory enqueue、run finalize 和 completion 布尔值。
- [ ] 删除或收窄不再使用的 best-effort start/finalize helper；保留 heartbeat/tool audit 所需最小 API。
- [ ] 保持 send/retry/edit/continue、附件、title outbox、search/RAG/compact 与 MCP 事件字段。
- Verify：完整 `/api/chat` route matrix、SSE parser/store regression、历史 branch/run metadata/public share tests。
- Gate：生产入口只有 coordinator 一套状态机，旧 orchestration 不再可达。
- Rollback point：单提交回滚代码；migration 保留。

## Phase 5: Cross-Layer Verification

- [ ] 定向测试：

```bash
pnpm test -- src/app/api/chat/route.test.ts \
  src/lib/chat/run-lifecycle.test.ts \
  src/lib/stream-agent-loop.test.ts \
  src/features/chat/model/sse.test.ts \
  src/features/chat/store/chatStreamStore.test.ts \
  src/lib/memory/extract.test.ts \
  src/lib/conversation-title/dispatch.test.ts \
  src/lib/infra/queue.test.ts \
  src/worker.test.ts \
  src/db/schema/pg.test.ts
```

- [ ] 在隔离数据库运行 completion transaction PostgreSQL tests：

```bash
env TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm test -- src/lib/chat/completion.pg.test.ts
```

- [ ] 运行 `pnpm lint`、`pnpm typecheck`、全量 `pnpm test`。
- [ ] 运行 `pnpm build`，保护 pg/pg-boss 动态 import 与 Edge instrumentation 边界。
- [ ] 独立复核事务原子性、Abort 竞态、SSE wire、敏感信息、migration journal/snapshot、worker 启停顺序和旧逻辑删除情况。
- [ ] 更新 `.trellis/spec/backend/chat-run-metadata.md`、`logging-guidelines.md`、`database-guidelines.md`、`error-handling.md` 中被严格 completion 取代的 best-effort 契约。
- Gate：定向、PG、lint、typecheck、全量 test、build 和独立审查全部通过。

## Risk Register

| Risk | Mitigation / Gate |
|---|---|
| strict DB gate 降低 DB 异常时回答可用性 | 生成前失败、脱敏错误、禁止产生不可审计回答；属于已接受取舍 |
| completion transaction 锁竞争 | 只在收尾短事务锁 conversation；模型调用永不位于事务内；PG 并发测试 |
| Abort 与 commit 竞态 | terminal cause latch；commit 开始后不由 transport abort 取消；adapter 取消后零写 |
| memory at-least-once 重放 | job id fencing、条件 claim、成功后匹配删除、mem0 dedupe；不虚假承诺 exactly-once |
| Web/worker payload 同步部署 | 最终不保留双 payload；部署/回滚必须协调，migration 不逆向删除 |
| 旧 spec 仍允许 finalize 吞错后 live success | 本 child 完成前必须同步四份 backend spec，check agent 按新契约复核 |

## Execution Results

- Phase 1-4 implemented: durable memory intent, strict run start, atomic completion repository, first-terminal-cause coordinator, Agent usage aggregation, and `/api/chat` single-path cutover.
- Isolated PostgreSQL verification passed after applying all migrations to a fresh temporary database with pgvector enabled: concurrent continue, memory-intent failure rollback, and terminal-run conflict rollback.
- Quality gates passed: lint, typecheck, 889 full-suite tests, production build, migration/journal/snapshot inspection, and independent transaction plus SSE/Abort review.
- `/v1/*` wire contracts and existing business data were not modified. The temporary PostgreSQL database was deleted after verification.

## Pre-Start Review Checklist

- [ ] 用户明确接受新增 memory intent 表、不回填历史数据和 Web/worker 协调部署风险。
- [ ] 用户明确接受 DB 不可用时不再继续调用模型，以及 `[DONE]` 收紧为 committed success。
- [ ] `prd.md`、`design.md`、`implement.md`、`research/evidence.md` 和两个 context manifest 已通过 Trellis validate。
- [ ] 仍保持 `status=planning`；只有用户在本 summary 后再次批准才执行 `task.py start`。
