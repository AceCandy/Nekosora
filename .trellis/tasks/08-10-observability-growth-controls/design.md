# 可观测数据增长治理设计

## 1. 指标标签边界

`packages/observability` 继续拥有 Prometheus metric 定义和最终标签防线。所有公共 observe 函数在 `.labels()` 前把值映射到固定集合，未知值统一为 `unknown`。类型联合用于调用方提示，但不能替代运行时映射。

旧请求指标不再使用原始模型 ID。Core 在模型目录/路由解析完成后传递 `model_catalog.modelType`，observability 将其映射为项目 `ModelType` 固定集合中的 `model_type` label；未解析请求只记 `unknown`。不推导供应商或模型家族，也不使用截断、哈希或动态缓存，因为这些做法仍可能随输入持续创建序列。Gateway execution/attempt 继续保留 operation/source/status/protocol，不增加 route/provider/model ID 标签。

新增保留任务指标仅使用固定枚举：claim `claimed|skipped|failed`、run `success|failed`、deleted status `success|failed|interrupted`，以及无标签耗时 histogram。日志只输出固定阶段消息。

## 2. 保留数据模型

追加 PostgreSQL 迁移：

- 为 `gateway_executions(status, created_at, id)` 增加清理索引，使终态 + cutoff + 最旧顺序查询有稳定访问路径。
- 新增单行 `gateway_retention_state`，固定主键与 `last_claimed_date`/`updated_at`。领取在一个条件 UPDATE/UPSERT 中使用数据库 UTC 日期，只有日期早于今天的事务返回成功。
- 同步 Drizzle schema、journal 和最新 snapshot；不改写任何已发布迁移。

状态表只协调调度，不存审计明细。单行设计避免每日 claim 表自身持续增长。

## 3. 清理事务

每次领取成功后执行一个独立清理事务：

1. 计算 success 30 天和 failed/interrupted 90 天 cutoff。
2. 用 CTE 按 `created_at,id` 选择最多 1000 个父 execution ID；只允许显式终态，并要求 `completed_at IS NOT NULL` 作为额外活跃保护。
3. 删除父 execution 并按 status 汇总返回数量；attempt 由现有 `ON DELETE CASCADE` 清理。
4. 提交后记录固定指标。

领取和删除分开：删除失败不会撤回当日 claim，避免多个 Worker 在数据库故障期间形成重试风暴；下一个 UTC 日自动重试。每小时调度用于 Worker 在当天晚启动时仍能领取，不用于一天内重复删除积压。

## 4. Worker 接入

复用现有 recovery scheduler，新增一个不对应 pg-boss handler 的 maintenance recovery，间隔 1 小时。现有 runtime 保证进程内单飞、立即执行、`unref`、stop 等待和失败后后续 tick；数据库 claim 提供跨实例单执行。

定义顺序保持三个业务队列 handler/recovery 不变，保留任务追加在其后。失败由 scheduler 捕获并记录固定消息，不携带 cause/stack。

## 5. 查询兼容

用量聚合现有最大 30 天窗口不变。Operations 的 provider 成功率、失败率和平均延迟显式加 `created_at >= now() - 90 days`，页面标题/辅助文字同步标明近 90 天。错误日志自然受 90 天失败保留窗口限制，不改变 API 结构。

## 6. 回滚与上线

- 指标收敛可独立回滚，但回滚会重新开放高基数风险。
- 停止注册 maintenance recovery 即可停止后续删除；已经删除的数据不可恢复，因此上线前必须在测试库验证 cutoff 与 EXPLAIN/批量行为。
- 状态表和索引可保留，不影响请求路径；如需结构回滚，追加反向迁移，不修改已发布 SQL。
- 本任务不自动执行历史全量追赶，每天最多删除 1000 条，优先保护线上负载。
