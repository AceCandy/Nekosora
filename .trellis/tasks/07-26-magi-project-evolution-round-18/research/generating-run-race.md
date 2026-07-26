# Generating / Run Race Research

## Confirmed Failure

```text
R1 start -> conversations.generating=true, R1 running
R2 start -> conversations.generating=true, R2 running
R1 finish -> conversations.generating=false
R2 remains running, but Sidebar reports completion
```

根因是 `conversations.generating` 与 `runs.status` 分别写入，且任一 route 收尾都无条件覆盖会话级布尔值：

- start bool：`src/app/api/chat/route.ts:314-322`
- success clear：`src/app/api/chat/route.ts:559-563`
- failure clear：`src/app/api/chat/route.ts:589-597`
- later finalize：`src/app/api/chat/route.ts:606-616`
- run insert/finalize：`src/lib/chat/run-lifecycle.ts:159-205`
- Sidebar read paths：`src/features/chat/actions/conversations.ts:93-120`

## Restart And Multi-Instance Constraint

`bootstrapDatabase` 每个 Node server 进程启动都会执行，`clearStaleGenerating` 无条件把所有 true 清成 false（`src/instrumentation.ts:2-45`；`src/lib/infra/db/bootstrap.ts:679-703`）。它没有实例所有权，滚动启动 B 会误清 A 的活跃会话。

现有 runs 只有 `status` 与 `createdAt`，没有 heartbeat、lease 或 process owner（`src/db/schema/pg.ts:391-405`）。`createdAt` 不能代表存活时间，进程内 metrics 也不能代表集群活动状态。

## Decision

采用 runs + lease 的读时派生：

- runId 已唯一且请求不支持接管，因此足以标识租约持有者，不新增 owner 字段。
- nullable `leaseExpiresAt` 兼容全部历史终态记录。
- 两分钟 lease、三十秒 heartbeat，均使用数据库 `now()`。
- Sidebar 的两个 DB 入口通过相关 EXISTS 动态计算；租约到期不需要另一个写者翻转缓存。
- 保留 legacy boolean 仅用于回滚，移除运行时和 bootstrap 对它的依赖。

## Why Not Conversation Lock

短事务 conversation 行锁能串行化 start/finalize，但只要最终结果仍缓存到 boolean，租约自然到期时就没有写者把 true 改回 false。把锁持有整个 provider 流会占用连接并违反既有消息事务边界，因此不能解决崩溃与多实例问题。

## Preserved Contracts

- run/tool DB 写入总体 best-effort，不阻断模型流。
- conversation/message 锁仅用于短消息写事务，不跨 provider 调用。
- `[DONE]` 晚于 assistant 必要持久化，并在本轮调整为晚于 await run finalize。
- abort、stream error 和 persistence failure 继续映射到既有终态。
- 所有 DB 访问继续经 `getDb/getSchema`，不静态引入 pg 驱动。

## Deferred

租约过期即可从 UI 视为 inactive，但崩溃行不会自动物化成 `interrupted`。周期性 janitor、run takeover、事件重放与跨实例恢复属于独立可靠性课题。

## Break-Loop Retrospective

### 1. Root Cause Category

- **B - Cross-Layer Contract**：请求生命周期维护会话布尔值，审计层另行维护 run 终态，Sidebar 又把布尔值当作活动事实；三层没有共享同一个活动定义。
- **E - Implicit Assumption**：原实现默认同一会话同时只有一个生成 run，并默认启动进程可以代表全部实例清理状态。
- **D - Test Coverage Gap**：既有测试覆盖单 run happy path，没有覆盖两个 run 交错完成、进程崩溃、滚动升级和租约到期真值表。
- **Confidence**：95%。代码调用链、并发交错、45 项聚焦回归及两路独立复核共同支持该结论；未在真实 PostgreSQL 验证迁移与锁行为，因此不声明 100%。

### 2. Why Previous Behavior Failed

1. 每个请求开始/结束写同一个 boolean，只能表达“最后一次写入”，不能表达活动 run 集合。
2. 启动时全量清零能掩盖单实例崩溃残留，却会在多实例与滚动升级时误清其他进程的活动状态。
3. 仅使用 `runs.status='running'` 会让崩溃行永久活跃；必须增加可自然失效的 lease。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | 以 fresh running runs 为唯一事实源，完成只更新当前 run | DONE |
| P0 | Runtime | 数据库时间租约 + 30 秒心跳 + 所有出口清 timer | DONE |
| P0 | Test Coverage | 覆盖并发、最后完成、expired/null/terminal、DONE 时序与 bootstrap | DONE |
| P1 | Documentation | 更新 run 生命周期、数据库迁移和跨层活动投影规范 | DONE |
| P1 | Deployment | 在真实 PostgreSQL 评估普通索引的锁窗口并执行迁移验证 | TODO |

### 4. Systematic Expansion

- **Similar Issues**：后续审视其他“父资源布尔状态 + 多个并发子任务”的缓存字段，但不在本轮扩大扫描或修改范围。
- **Design Improvement**：长任务活动状态优先从带过期边界的独立操作集合派生，不用父级单值或易漂移计数器表示。
- **Process Improvement**：此类跨层改动必须先写 start/overlap/finalize/crash/rolling-upgrade 真值表，再检查所有投影消费者是否共享谓词。

### 5. Knowledge Capture

- [x] 更新 `.trellis/spec/backend/logging-guidelines.md`。
- [x] 更新 `.trellis/spec/backend/database-guidelines.md`。
- [x] 更新 `.trellis/spec/backend/chat-message-references.md`。
- [x] 更新 `.trellis/spec/guides/cross-layer-thinking-guide.md`。
- [x] 保留真实 PostgreSQL 迁移与锁验证为显式剩余风险。
