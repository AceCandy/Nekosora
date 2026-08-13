# 可观测数据增长治理实施计划

## 1. 指标基数

- [x] 为 observability 标签增加固定集合映射与 `unknown` fallback。
- [x] 移除原始请求 model label 的传递，改用 `model_catalog.modelType` 对应的固定 `model_type` label。
- [x] 增加恶意、超长、未知输入回归测试，并验证既有低基数标签不变。

## 2. 数据库结构

- [x] 在 Drizzle schema 增加 `(status, created_at, id)` 清理索引和 `gateway_retention_state` 单行状态表。
- [x] 运行 `pnpm db:generate:pg` 生成新 migration，并核对 SQL、journal、snapshot；不得改写 `0011` 及以前迁移。
- [x] 增加 migration 契约测试和数据预检/回滚说明。

## 3. 领取与批量清理

- [x] 实现数据库 UTC 日条件 claim，证明并发只有一个领取成功。
- [x] 实现最多 1000 条、按 `created_at,id` 稳定顺序的终态父记录删除，依赖 cascade 清理 attempts。
- [x] 覆盖 30/90 天边界、running/completedAt 保护、批次上限、状态计数和事务失败。

## 4. Worker 与可观测性

- [x] 将每小时 maintenance recovery 追加到 Worker definitions，复用现有 scheduler 生命周期。
- [x] 增加 claim/run/deleted/duration 固定低基数指标和脱敏失败日志。
- [x] 更新 runtime/definitions 测试，验证注册顺序、立即执行、失败隔离和停止等待。

## 5. Operations 口径

- [x] 将 Operations 聚合查询限制为近 90 天并同步页面文案。
- [x] 增加查询/页面测试，确认 90 天外数据不参与统计且现有字段结构不变。

## 6. 验证

- [x] 运行 observability、retention、Worker 和 Operations 定向测试。
- [x] 在隔离 PostgreSQL 测试库验证完整 migration、并发 claim、cascade、批次上限和查询计划；结束后强制清理测试库。
- [x] 运行 `pnpm check`、`pnpm test`、`pnpm build:worker`、`git diff --check` 和 Trellis task validate。
- [x] 独立复核指标基数、删除边界、迁移同步、日志脱敏与多 Worker 竞争。

## 7. 回滚点

- 标签映射、retention service、Worker definition、Operations 查询和 migration 分层提交，便于单独回滚未发布改动。
- 已执行的数据删除不可逆；发布前先部署代码但关闭任务不在本次范围，因此必须通过测试库证据后再发布。
- 若生产负载异常，首先停止 Worker maintenance registration；不要扩大批次或缩短周期追赶积压。
