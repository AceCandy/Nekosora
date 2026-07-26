# Best-Effort DB Stall Research

## Confirmed Failure

```text
stream finishes
  -> streamChat finally awaits logUsage
  -> getDb/insert never settles
  -> async generator never completes
  -> route persistence/finalize/DONE/close never runs
```

同类阻塞点还包括 response 前的 `startRun`、流中的 tool-call 审计、`[DONE]` 前的 `finalizeRun`，以及收尾失败分支标为尽力执行的 conversation 时间更新。catch 只能处理 reject，不能处理永久 pending。

## Runtime Evidence

- `src/lib/usage.ts:79-164`：`logUsage` await `getDb` 和 insert，外层只有 catch。
- `src/lib/stream.ts:332-338,368-418`：attempt 与 final usage 均被生成器 await。
- `src/lib/chat/run-lifecycle.ts:161-225`：start/heartbeat/finalize await DB，无等待上限。
- `src/app/api/chat/route.ts:317-345,613-645`：start 在 Response 前；finalize 在 DONE 前；heartbeat 可重叠且 cancel 不清 timer。
- `src/app/api/chat/route.ts:595-605`：失败 fallback update 属于 best-effort，却仍可阻塞外层 finally。
- `src/lib/infra/db/index.ts:45-64`：Pool 只配置连接数。

## Dependency Constraint

- node-postgres 8.22.0 默认 `connect_timeout=0`、`statement_timeout=false`、`query_timeout=false`。
- Drizzle 0.45.2 node-postgres session 的 execute/transaction 类型不暴露 AbortSignal，当前 query builder 无法直接取消。
- Drizzle migrator 在 transaction 中执行全部迁移；`CREATE INDEX CONCURRENTLY` 不能直接加入现有迁移流程。

## Decision

- 本轮对明确 best-effort 且阻塞主流程的调用增加 5 秒应用层等待预算，包括 route 的失败 fallback update。
- heartbeat 用原始 Promise 做单飞，不对底层完成作假；abort/cancel 立即停止后续 timer。
- 不修改全局 Pool 超时或必要消息持久化，避免把审计策略扩散为全数据库行为。

## Residual Risk

应用层超时不能取消底层查询。late write 可完成；数据库永久失联时，每个请求仍可能保留有限数量的底层 Promise/pg 工作。若要彻底释放资源，后续需单独设计全局或按连接的 PostgreSQL 超时预算，并验证迁移、RAG 和后台任务。
