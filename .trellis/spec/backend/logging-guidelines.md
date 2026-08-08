# Logging Guidelines

> Nekusora 网关执行观测契约。权威实现：`src/lib/gateway-execution/`、`src/db/schema/pg.ts`、`src/lib/usage-aggregate.ts` 与 `src/lib/repositories/error-log-repository.ts`。

## Scenario: Gateway Execution / Attempt Facts

### 1. Scope / Trigger

- 修改 Chat、Image、TTS、STT 的 route/key 执行、上游错误、用量统计、管理页查询或网关 metrics 时适用。
- `gateway_executions` / `gateway_attempts` 是当前统一事实模型。旧 `usage_logs` / `ops_error_logs` 已破坏性删除，不得恢复双表分流。
- `runs` / `tool_calls` 是 WebChat 业务审计，不属于网关执行观测，禁止合并或清空。

### 2. Signatures

- `executeGateway<TEvent, TResult>(options): AsyncGenerator<TEvent, GatewayExecutionOutcome<TResult>, void>`
- `GatewayTelemetryPort.startExecution(input): Promise<void>`
- `GatewayTelemetryPort.recordAttempt(input): Promise<void>`
- `GatewayTelemetryPort.finalizeExecution(input): Promise<void>`
- `listErrorLogs(...)` / `getErrorLog(...)` / `listAttemptsByRequestIds(...)`
- `listUsageLogs(...)` / `getTimeSeries(...)` / `getModelBreakdown(...)` / `getSourceBreakdown(...)`

Database facts:

- `gateway_executions`: one row per logical execution, status `running | success | failed | interrupted`.
- `gateway_attempts`: one row per real or rejected upstream attempt, unique `(execution_id, attempt)`, status `success | failed | interrupted | rejected`.
- `gateway_attempts.execution_id -> gateway_executions.id ON DELETE CASCADE`; caller identity FKs use `ON DELETE SET NULL`.

### 3. Contracts

- Engine creates one running execution, records exactly one attempt row per adapter invocation/rejection, and finalizes the execution once.
- Final usage and logical execution metrics are counted once. Attempt metrics are separate and may count retries.
- Attempt metric labels are limited to `operation`, `status`, and provider `protocol`; model, route, provider id, request id, and key are forbidden high-cardinality labels.
- Telemetry is best-effort and bounded. DB or metrics failures never alter the gateway outcome; repository sinks apply redaction again before persistence or console output.
- Raw provider `Error`, API key, headers, and base URL never enter telemetry. Only `SafeGatewayError`, `GatewayRouteSnapshot`, and `upstreamKeyMasked` may cross the engine boundary.
- `redactErrorMessage(error, secrets, fallback)` 必须先清理已知凭据与敏感字段，再移除完整 `http` / `https` / PostgreSQL URL。调用方可以保留低敏错误阶段文本，但不得把原始 `Error` 作为第二个 console 参数绕过该边界。
- Route/provider/upstream names are write-time snapshots. Historical rows do not change when configuration names change.
- `taskKind` is nullable: main reply/gateway request is `null`; background title/memory/compact calls use their stable task kind.
- Route-layer auth/body failures occurring before the engine may use the compatibility `logUsage` entry to insert one final execution row. Engine-owned failures must not be written again by route handlers.
- Agent tool loops share one telemetry session and one execution id. Internal steps globally renumber attempts and aggregate usage; only the outer loop finalizes.
- `firstTokenLatencyMs` is measured from logical execution/attempt start to the first non-empty user-visible text delta. Response commitment is independent: reasoning, tool calls, and empty text deltas may block failover after they are emitted, but they must not set `firstTokenAt`. Atomic operations and streams without visible text leave it null.
- Stream consumers are allowed to stop after a terminal event only through the coordinator's settlement step; the stream itself must request nested engine closure non-blockingly in `finally` for Abort/consumer `return()`. Final usage callbacks run from that cleanup path so `gateway_executions` cannot remain `running` merely because generator tail code was skipped.

### 4. Validation & Error Matrix

| Condition | Attempt fact | Execution fact / metric |
|---|---|---|
| First key fails, second succeeds | failed then success | one success execution; one logical metric |
| Unsupported route protocol | rejected | continue before commit; final outcome follows later attempt |
| All routes fail | one row per attempt | one failed execution |
| Abort | interrupted attempt when an attempt started | one interrupted execution; no breaker failure |
| Reasoning/tool event before visible text | response is committed; later failure cannot fail over | `firstTokenLatencyMs` remains null until a non-empty text delta |
| Telemetry DB/metrics throws or times out | best-effort may be missing | gateway outcome remains unchanged |
| Route auth/body rejection before engine | no upstream attempt | one compatibility execution row |
| Agent has multiple model steps | globally ordered attempts | one aggregated final execution |

### 5. Good / Base / Bad Cases

- Good: a two-route request records two attempts and one final execution; only the final execution contributes to usage totals.
- Good: a reasoning event commits the response without starting TTFT; the first non-empty visible text delta records TTFT.
- Good: an error containing key/header/base URL reaches storage only after exact-value and generic redaction.
- Base: a single successful attempt creates one attempt and one success execution.
- Bad: each retry writes another final execution, inflating calls and tokens.
- Bad: reuse `commitsResponse` as the TTFT trigger; it makes hidden reasoning and tool calls look like visible answer latency.
- Bad: a route catches an engine failure and inserts a second final row.
- Bad: attempt labels include `model`, `routeId`, `providerId`, or key masks.

### 6. Tests Required

- `gateway-execution/engine.test.ts`: key retry, route failover, commit-before-yield, visible-text TTFT independent from reasoning/tool commitment, Abort, deterministic errors, rejected protocols, credential/route redaction, telemetry failure isolation, and iterator-close finalization.
- `gateway-execution/telemetry.test.ts`: start/attempt/finalize mappings, DB/metrics best-effort, persistence redaction.
- `redaction.test.ts`：断言 provider 与 PostgreSQL URL 不离开错误边界；RAG retrieve 与 Chat compaction 降级测试断言 console 只接收脱敏字符串。
- Schema/migration tests: both facts, unique attempt number, FK actions, journal/snapshot, no `CASCADE` drop, and only old log tables removed.
- Usage/error repository tests: success-only aggregation, time range/user isolation, failed attempt-chain filtering, pagination count consistency.
- Agent loop tests: one execution finalization, globally ordered attempts, aggregated tokens, one final metric; stream tests also cover natural final usage and consumer Abort cleanup.
- Metrics smoke: execution counter, attempt counter, execution duration, and absence of high-cardinality labels.

### 7. Wrong vs Correct

```typescript
// Wrong: retry is represented as another logical request.
await logUsage({ status: "failed", ...attempt });
await logUsage({ status: "success", ...final });

// Correct: attempts and final outcome have separate facts.
await telemetry.recordAttempt(attempt);
await telemetry.finalizeExecution(final);

// Wrong: response commitment is not proof that the user saw answer text.
if (event.commitsResponse) firstTokenAt ??= Date.now();

// Correct: keep failover safety and visible-answer latency as separate facts.
if (event.commitsResponse) committed = true;
if (event.firstTokenAt !== undefined) firstTokenAt ??= event.firstTokenAt;
```

## Query And Presentation Contracts

- Usage aggregates and totals read only successful `gateway_executions` and apply the same user/time range.
- Error lists read failed/interrupted executions. Retry details read only failed/interrupted/rejected attempts; successful attempts must not inherit the final execution error.
- `userId` passed to repository methods is a mandatory server-side isolation predicate for panel users; admin omission means all users.
- Error detail fields are visible to their owning user. Authorization relies on the query predicate, not destructive field blanking.
- Default auth-noise exclusion remains a query filter; an explicit phase filter overrides it.
- `createdAt` ranges are inclusive (`gte`/`lte`) and list/count queries must share one where expression.

## What Not To Log

- Complete request/response bodies, raw `Error` objects, causes, or stacks.
- Plaintext API keys, Authorization/custom header values, provider base URLs, cookies, tokens, or connection strings.
- Raw `ResolvedRoute`; use `GatewayRouteSnapshot` and a masked upstream key.

## Scenario: Queue And Worker Lifecycle Logs

### 1. Scope / Trigger

Apply this contract to pg-boss adapter events, worker handler outcomes, recovery scans, startup rollback, signal shutdown, and queue-backed producer fallback. These are operational low-cardinality logs, not entity audit records.

### 2. Signatures

- Handler success: `[worker] <catalog-job-name>: completed|noop`
- Handler failure: `[worker] <catalog-job-name>: retryable_failure`
- Queue event: `[queue] pg-boss error`
- Recovery failure: `RecoveryDefinition.failureMessage`
- Lifecycle failure: fixed stage text, optionally followed by a catalog job name

### 3. Contracts

- Job name comes from the catalog definition; outcome is limited to `completed`, `noop`, or `retryable_failure`.
- Never append queue payload, job/file/conversation/user ID, user text, storage path, model context, or durable-row contents.
- Never pass raw `Error`, `cause`, or stack to `console`. Queue/provider/database URLs, Authorization/custom headers, credentials, cookies, and connection strings are forbidden even in development logs.
- pg-boss events and generic recovery/runtime cleanup use fixed messages rather than redacting unknown third-party error text.
- A domain boundary may emit an already bounded and redacted diagnostic when that diagnostic is part of its existing contract, but worker orchestration must not enrich it with payload or raw infrastructure errors.
- Shutdown continues cleanup after logging a stage failure. Logs do not replace exit status: incomplete cleanup or drain still exits with code 1.

### 4. Validation & Error Matrix

| Event | Allowed fields | Forbidden fields |
| --- | --- | --- |
| Handler resolved | Catalog name, `completed|noop` | Payload, entity ID |
| Handler rejected | Catalog name, `retryable_failure` | Raw message/cause/stack |
| pg-boss error event | Fixed queue event text | Event argument |
| Recovery scan/item failure | Fixed recovery name/stage | Row ID, raw DB/provider error |
| Startup/shutdown cleanup failure | Fixed lifecycle stage, catalog name when identifying a scheduler | URL, connection string, Error object |
| Upload compensation delete failure | Fixed cleanup stage | Storage key and cleanup Error |

### 5. Good / Base / Bad Cases

- Good: `[worker] file-process: noop` records an ownership loser without revealing `fileId`.
- Good: `[memory-extraction-recovery] dispatch failed` allows alert grouping without exposing durable job IDs.
- Base: `[worker] ready` and `[worker] stopping` mark lifecycle stages.
- Bad: `[worker] file-process <fileId> failed: <error>` creates high-cardinality logs and leaks entity/infrastructure data.
- Bad: logging a pg-boss event argument after regex redaction assumes arbitrary SQL parameters are discoverable secrets.

### 6. Tests Required

- Inject adversarial payload/user text/entity IDs plus provider and PostgreSQL URLs, headers, credentials, cause, and stack; assert none appear in handler, recovery, queue event, cleanup, or upload compensation logs.
- Assert exact stable calls for pg-boss events, handler outcomes, scan failures, lifecycle cleanup failures, and upload compensation failures.
- Assert per-item recovery failure does not stop later items and repeated signals do not duplicate cleanup/exit logs through multiple shutdown runs.
- Keep domain bounded/redacted diagnostic tests separate from generic runtime tests.

### 7. Wrong vs Correct

```typescript
// Wrong: entity and raw infrastructure error cross the orchestration boundary.
console.error(`[worker] ${definition.job.name} ${payload.id}`, error);

// Correct: fixed catalog name and bounded outcome only.
console.error(`[worker] ${definition.job.name}: retryable_failure`);
```

## Common Mistakes

- Writing engine-owned final facts in route handlers causes duplicate calls and tokens.
- Treating each failed attempt as a failed logical request corrupts availability metrics.
- Querying all attempts into an error-only DTO makes successful attempts inherit misleading final errors.
- Applying a time range to charts but not totals creates internally inconsistent dashboards.
- Assuming sink regex can discover opaque secrets ignores values known only inside the provider boundary.

## Scenario: WebChat Run 审计生命周期

### 1. Scope / Trigger

- `/api/chat` 创建一次用户可见生成时，将现有 `runs`、`tool_calls` 与 `messages.runId` 接入审计链路。
- `runs` 同时承担跨实例活动状态事实源时，必须维护数据库时间租约；请求幂等、事件重放与过期 run 终态物化另行设计。

### 2. Signatures

- `startRunStrict({ runId, conversationId, userId, platformModelName }): Promise<void>`
- `withBestEffortTimeout<T>(operation: () => Promise<T>): Promise<T>`，固定等待预算 5 秒
- `heartbeatRun(runId): Promise<void>`
- `recordToolCallStart({ runId, toolCallId, toolName, args })`
- `recordToolCallResult({ runId, toolCallId, result, isError })`
- `persistChatCompletion(...)`：同一事务写 assistant、conversation 时间、memory intent 与 terminal run。
- `executeChatCompletion(...)`：first-terminal-cause、stream fold、heartbeat 与唯一成功信号。
- 活动谓词：`runs.status = 'running' AND runs.lease_expires_at > now()`。

### 3. Contracts

- 普通发送、重试、编辑重发与续写每轮生成唯一 `runId`；同一 Agent 多轮必须共享该值。
- 新建 user 与本轮新建/续写 assistant 写入 `runId`；复用历史 user 时不得改写其归属。
- `runs` 是活动状态唯一事实源；会话列表与轮询共用有效租约谓词动态派生 `generating`。`conversations.generating` 仅供旧版本回滚，新 runtime 不读写。
- `startRunStrict` 使用 PostgreSQL `now() + interval '2 minutes'` 创建租约；失败或超时禁止模型调用。只有确认成功后才每 30 秒调用 `heartbeatRun`。
- start 是生成门禁，assistant/run/memory completion 是成功门禁，均不得 best-effort。tool audit、失败后的 run 收敛、post-commit artifact 与即时 memory dispatch 仍可 best-effort。
- `heartbeatRun` 保留原始 DB Promise 作为单飞信号，不套 5 秒 wrapper；coordinator 在 Abort、stream terminal 与进入 completion transaction 前停止后续 tick。
- coordinator 锁存首个终态原因；Agent 多轮共享 runId，最终 run usage 使用跨轮聚合值。
- terminal run update 必须匹配 `runId + conversationId + userId + running` 并 `RETURNING` 一行，否则整个 completion transaction 回滚。
- 所有 SSE 帧经 route 的取消安全 adapter 写入；只有 committed success 产生一个 `finish`，adapter 紧接 `[DONE]`。
- Gateway execution telemetry 与 run 审计并行存在：前者描述上游尝试，后者描述会话业务生命周期；不得互相级联删除。

### 4. Validation & Error Matrix

| 条件 | `runs.status` / 租约 | 对外行为 |
|---|---|---|
| fresh running run | `running` 且租约未过期 | `generating=true` |
| 同会话一条 run 终结，另一条仍 fresh | 当前 run 终态，另一条 `running` | `generating=true` |
| 最后一条 fresh run 终结 | `success` / `failed` / `interrupted` | `generating=false`；成功时 finalize 后发 `[DONE]` |
| 进程崩溃或心跳停止 | 行可保持 `running`，租约最终过期 | 过期后 `generating=false` |
| strict start 写入失败 | 无已确认活动 run | 不调用模型；error；无 `[DONE]` |
| completion 任一核心写失败 | transaction 全回滚；失败收敛可另行 best-effort | error；无 `finish` / `[DONE]` |
| assistant / 会话收尾持久化失败 | 当前 run 最终标记 `failed` | error SSE；无 `[DONE]` |

### 5. Good / Base / Bad Cases

- Good：同一会话 R1、R2 并发时，R1 终结只更新自身；R2 的有效租约继续让侧栏显示活动。
- Good：Agent 两轮的 tool-call/tool-result 与最终 assistant 都关联同一 run。
- Base：无工具的普通生成仍创建、续租并收敛一条 run，SSE 载荷不变。
- Bad：任一请求结束时直接把会话级布尔值写成 false，会提前清除其他并发 run 的活动状态。
- Bad：启动时全量清理活动布尔值，会误伤其他实例仍在执行的请求。

### 6. Tests Required

- `run-lifecycle.test.ts` 覆盖 strict start 确认/通用失败，以及 tool/失败收敛写入的有界、脱敏行为。
- Agent loop 测试断言每轮 `streamChat` 接收同一 `runId`。
- 会话 action 测试覆盖 fresh/expired/null/terminal 真值表，并断言列表与轮询共用同一活动谓词。
- coordinator 测试覆盖 heartbeat 单飞、first-terminal-cause、Abort-ignoring iterator、事务失败与 committed-success-only finish。
- route 接线复核覆盖 send/retry/edit/continue 身份、现有 SSE 字段、cancel signal，以及 `finish` 紧邻 `[DONE]`。
- bootstrap 回归须断言启动流程不再全量更新 `conversations.generating`。

### 7. Wrong vs Correct

```typescript
// Wrong:assistant、run 与成功信号分开提交。
await db.update(conversations).set({ generating: false });
safeEnqueue(doneFrame);
await finalizeRun({ runId, status, tokenUsage });

// Correct:当前 run 与 assistant 在一个事务终结，提交后才允许成功信号。
const committed = await persistChatCompletion(input);
safeEnqueue(finishFrame(committed));
safeEnqueue(doneFrame);
```
