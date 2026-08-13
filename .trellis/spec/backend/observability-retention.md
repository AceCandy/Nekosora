# Observability And Gateway Retention

## Scenario: Bounded Metrics And Execution Retention

### 1. Scope / Trigger

- 修改 `packages/observability` 公共指标、Gateway execution/attempt schema、Worker maintenance 或 Operations 统计口径时适用。
- 目标是同时限制 Prometheus 时间序列和 PostgreSQL 日志增长，不影响请求热路径。

### 2. Signatures

- `observeRequest({ source, modelType, status, latencyMs, promptTokens, completionTokens })`
- `claimGatewayRetention(): Promise<boolean>`
- `deleteExpiredGatewayExecutions(): Promise<{ success; failed; interrupted }>`
- `runGatewayRetention(): Promise<void>`
- `gateway_retention_state(id, last_claimed_date, updated_at)`
- `gateway_executions.model_type` 与索引 `(status, created_at, id)`

### 3. Contracts

- Prometheus label 在 observability 出口映射到固定集合；任何未知运行时值必须变为 `unknown`。
- 原始 model ID 不得成为 label。正常 execution 固化 `model_catalog.modelType`；路由前错误使用 `unknown`，不得按名称推断。
- `success` 保留 30 天，`failed`/`interrupted` 保留 90 天；`running` 和 `completed_at IS NULL` 永不删除。
- 每批按 `created_at,id` 最旧顺序最多删除 1000 条父 execution，attempt 依赖 FK cascade。
- Worker 每小时检查，单行 UTC 日期 claim 保证所有实例每天最多一个批次；删除失败不撤销当天 claim。
- Operations provider 成功率与平均延迟只统计近 90 天；`provider_ref IS NOT NULL` 排除尚未 finalize 的 execution。

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| 未知/超长 label | 记录为 `unknown`，不创建动态值 |
| 同一 UTC 日并发 claim | 仅一个调用返回 `true` |
| claim 数据库失败 | 记录固定 `failed` 指标并抛出，下一小时可重试 |
| 当天已领取 | 记录 `skipped`，不执行删除 |
| 删除失败 | 记录固定 run failure 并抛出，不记录 ID/原始错误 |
| 终态达到阈值且 completed | 进入最多 1000 条候选集 |
| running、未 completed 或窗口内 | 保留 |

### 5. Good / Base / Bad Cases

- Good: 多个 Worker 同时启动，数据库 UTC claim 只允许一个执行单批删除。
- Base: 当天已执行，后续小时检查快速跳过。
- Bad: 用应用服务器日期、进程内锁或原始 model/provider 字符串协调/标记，会造成跨实例重复或无界序列。

### 6. Tests Required

- 指标单测必须用恶意、超长和未知值断言 `unknown` fallback，并保留所有已批准枚举。
- retention 单测必须断言严格 `<` 30/90 天、`completed_at IS NOT NULL`、稳定排序、1000 上限和不包含 running。
- 隔离 PostgreSQL 测试必须覆盖并发 claim、删除边界、批次上限和 attempt cascade；库名必须匹配 `nekusora_gateway_retention_test_<16 hex>`。
- migration 测试必须断言 SQL、journal、snapshot、model type 列、状态表和组合索引同步。
- Worker 测试必须证明 maintenance 不注册 queue handler，但参与 recovery 启停和逆序 drain。

### 7. Wrong vs Correct

Wrong:

```typescript
requestTotal.inc({ model: requestedModel });
if (new Date().getDate() !== lastRun) await deleteAllExpired();
```

Correct:

```typescript
requestTotal.inc({ model_type: fixedModelType });
if (await claimGatewayRetention()) await deleteExpiredGatewayExecutions();
```
