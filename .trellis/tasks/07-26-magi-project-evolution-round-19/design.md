# Technical Design

## Boundary

改动限定在：

- 新增一个纯 Promise 有界等待 helper，统一 timer 清理、`unref()` 与 timeout error。
- `src/lib/chat/run-lifecycle.ts`：给会阻塞调用方的 run/tool best-effort 写入加等待上限。
- `src/lib/usage.ts`：从导出入口限制整个用量日志写入等待。
- `src/app/api/chat/route.ts`：heartbeat 单飞、abort/cancel 立即停止、finally 复用同一清理函数，并限制收尾失败后的尽力更新时间写入。
- 对应 unit/route/stream 回归测试与 logging/database/chat 契约。

不修改数据库 schema、Provider 生成、消息事务、SSE 事件或 UI。

## Bounded Wait Contract

共享 helper 接收 Promise factory，缺省等待 5 秒：

```ts
withBestEffortTimeout<T>(operation: () => Promise<T>): Promise<T>
```

- factory 同步 throw、Promise reject 与 timeout 都 reject 给调用方，由领域层按现有规则脱敏记录并降级。
- timeout timer 创建后在运行时支持时立即 `unref()`；operation 先完成时必须清 timer。
- `Promise.race` 已注册底层 Promise 的 resolve/reject handler；调用方超时返回后，底层晚 reject 不形成 unhandled rejection。
- helper 不声称取消 operation。Drizzle 当前无 signal 通道，晚完成允许产生审计写入。
- 固定 5 秒是 best-effort 主流程等待预算，不是 PostgreSQL statement timeout，也不新增环境配置。

## Run And Tool Writes

`run-lifecycle` 增加内部执行器：

```text
operation factory
  -> withBestEffortTimeout
  -> success: return true/void
  -> reject/timeout: redact + short console error -> false/void
```

- `startRun` 返回 `boolean`，timeout 与普通 DB 失败一致为 `false`。
- `finalizeRun`、`recordToolCallStart`、`recordToolCallResult` 保持 `Promise<void>` 与不抛契约。
- `heartbeatRun` 不放入有界 wrapper：route 从不 await 它推进主流程，保留原 Promise 作为真实 in-flight 信号，才能在底层 pending 时可靠阻止后续重叠调用。

收尾失败分支的 conversation `updatedAt` 更新明确是 best-effort，直接使用同一 helper 包住包含 `db.update` 的 factory；timeout 后继续进入外层 finally。成功路径的消息事务和 conversation 更新时间仍是必要持久化，不改变等待语义。

## Usage Logging

保留现有 `logUsage(params): Promise<void>` 导出签名，将当前实现下沉为内部函数：

```text
logUsage
  -> withBestEffortTimeout(logUsageInternal)
  -> reject/timeout: existing redacted console error
  -> always resolve void to caller
```

这样所有 Chat、gateway、attempt 和后台副任务调用点共享同一等待边界，不需要逐个包裹。成功分流、字段、Prometheus 顺序与 skipMetrics 行为不变。

## Heartbeat State Machine

route 为单个请求维护：

```text
timer tick
  -> aborted/stopped? skip
  -> heartbeatInFlight exists? skip
  -> assign heartbeatRun(runId)
  -> finally clear only the same promise

request abort / stream cancel / route finally
  -> stopHeartbeat()
  -> clear interval once
  -> no new ticks
```

- timer 仍为 30 秒并 `unref()`。
- `runStarted=false` 或请求在 stream start 前已 aborted 时不创建 timer。
- request abort handler 与 ReadableStream `cancel()` 都先调用 `stopHeartbeat()` 再 abort 上游；stream start 已 aborted 时不得创建 timer。
- 停止调度不等待也不取消当前 heartbeat，也不清空其 in-flight guard；它最多保留一次底层操作。
- finally 继续 `await finalizeRun`，但该函数在 5 秒内按 best-effort 收敛，因此 `[DONE]` 顺序保持且等待有界。

## Alternatives Rejected

- 全局 Pool `statement_timeout/query_timeout`：会影响迁移、RAG 和后台长查询；当前缺少全仓查询预算，blast radius 超出本轮。
- 只在 route 对 `finalizeRun` 做 `Promise.race`：遗漏 start/tool/usage 等同类阻塞点，契约继续漂移。
- 给 heartbeat 使用同一 timeout 后按 interval 重试：底层 Promise 仍可能 pending，会重新产生隐藏重叠。
- 跳过必要消息持久化：可能发送 `[DONE]` 但消息未落库，违反现有可靠完成契约。

## Test Design

1. helper fake-timer tracer：fast resolve/reject、timeout、timer cleanup、可选 `unref()` 与 late reject 无泄漏。
2. lifecycle tracer：pending start 在 5 秒后 false；pending finalize/tool write resolve void；快速路径与脱敏错误不变。
3. usage tracer：pending getDb/insert 在 5 秒后 resolve void；success/failed 分流现有断言继续通过。
4. route heartbeat tracer：用 unresolved deferred heartbeat 推进多个 tick 仍只调用一次；resolve 后再推进一 tick才允许第二次；request abort/cancel 后无新调用。
5. route 收尾 tracer：fallback conversation update 永久 pending 时，推进 5 秒后仍 finalize/close 且无 `[DONE]`；现有测试继续断言 `[DONE]` 晚于 finalize Promise。
6. lifecycle/helper 单测是 finalize 5 秒预算的权威验证；route 不通过永久 mock + 手动 release 伪装 timeout 覆盖。

## Rollback

- helper 与调用包装均为纯应用层改动，无 schema/数据回滚。
- 回滚 route 单飞逻辑恢复旧 interval 行为，不影响 run 租约数据格式。
- 若 5 秒预算误判，可在后续有证据时调整单一常量；本轮不预设 env 配置。
