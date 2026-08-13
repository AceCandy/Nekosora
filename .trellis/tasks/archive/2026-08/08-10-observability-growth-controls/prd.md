# 可观测数据增长治理

## Goal

限制调用方可控标签造成的 Prometheus 时间序列增长，并让 Gateway execution/attempt 数据在明确窗口后安全、有界地清理。

## Background

- `packages/observability/src/index.ts:23-45,118-132` 的旧请求指标直接把原始 `model` 字符串写入三个 Prometheus label；调用方 `packages/core/src/lib/usage.ts:113-125` 没有运行时收敛。
- Gateway execution 指标已刻意不携带 model/route，但 observability 公共函数的多个字符串参数仍缺少运行时白名单兜底。
- `packages/db/src/schema.ts:1042-1138` 中 `gateway_attempts.execution_id` 对 execution 使用 `ON DELETE CASCADE`；两表只有单列 status/created 索引，没有保留清理所有者。
- Worker recovery 在 `packages/core/src/lib/worker/runtime.ts:80-121,213-230` 提供立即执行、周期、进程内单飞和失败后下周期重试，但多 Worker 实例没有跨进程 leader。
- 用量页面最多查询 30 天成功记录；管理端 Operations 当前使用全历史 execution 计算成功率和平均延迟。

## Requirements

- R1. 原始请求模型字符串不得进入 Prometheus label。模型观测维度固定为 `model_type`，其值必须来自 `model_catalog.modelType` 对应的项目 `ModelType` 固定集合；无法解析或不支持的值统一归入 `unknown`，不得使用哈希或截断继续制造新序列。
- R2. observability 公共出口必须对 source/status/operation/protocol/governance 等标签做有限集合映射，运行时未知值归入 `unknown` 或所属维度的固定 fallback。保留来源、状态、协议、操作和延迟观测能力。
- R3. execution 保留策略固定为：`success` 30 天，`failed`/`interrupted` 90 天；`running` 永不由保留任务删除。删除 execution 时通过现有 FK cascade 同步删除 attempts，不建立第二套 attempt 生命周期。
- R4. Worker 每小时检查一次清理资格，但数据库单行 claim 保证所有 Worker 全局每天最多成功领取一次。清理不进入请求热路径，失败只记录固定阶段并在下个周期重试。
- R5. 每次只删除最旧的最多 1000 条符合条件的 execution；一次领取最多执行一个批次，避免启动追赶对数据库造成连续大删除。剩余积压由后续每日批次消化。
- R6. 新增与 `status + created_at` 清理谓词匹配的 PostgreSQL 索引和单行清理状态；必须追加 migration、Drizzle journal/snapshot、迁移契约测试和回滚说明。
- R7. 清理过程提供固定低基数指标：领取结果、运行结果、按终态删除量和耗时；日志不得包含 request/user/key/provider ID、原始错误或数据库连接信息。
- R8. Operations 成功率、失败率和平均延迟统一改为近 90 天，并在界面中明确口径；不增加全历史聚合归档。

## Acceptance Criteria

- [ ] 任意模型、协议或治理字符串输入不会创建白名单之外的 Prometheus label 值；主要来源、状态、操作、协议和模型分类仍可观察。
- [ ] 数据库测试证明：30 天前 success 和 90 天前 failed/interrupted 可按最旧顺序最多删除 1000 条；边界内记录、running 和不完整活跃记录不受影响；attempt 随父记录级联删除。
- [ ] 多个 Worker 并发领取时每天只有一个成功，失败后可在后续小时重试；一次运行只执行一个批次。
- [ ] 清理领取、结果、删除量和耗时可通过固定低基数指标观察，日志符合脱敏约束。
- [ ] Operations 仅统计并显示近 90 天，现有 30 天用量页语义保持不变。
- [ ] migration、journal、snapshot、定向测试、`pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 替换 Prometheus、Gateway execution/attempt 事实模型或 Worker runtime。
- 增加全历史按日聚合表、数据仓库或外部归档。
- 清理 `runs`、`tool_calls`、聊天消息、计费余额或 pg-boss 自有表。
- 删除或自动修复长期停留在 `running` 的异常记录；该问题需要独立的恢复/对账策略。
