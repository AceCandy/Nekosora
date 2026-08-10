# 可观测数据增长治理

## Goal

限制调用方可控标签导致的 Prometheus 时间序列增长，并为 Gateway execution/attempt 数据建立明确保留与清理边界。

## Background

- `packages/observability/src/index.ts:22-44,90-103` 直接把请求模型值写入多个 Prometheus `model` label。
- `gateway_executions` 与 `gateway_attempts` 已持续记录执行数据，仓库内未发现明确 TTL、归档或批量清理所有者；部署外策略尚未核验。

## Requirements

- R1. `model` 等指标标签必须来自有界、规范化的维度；未知或攻击性输入不能创建无限新时间序列。
- R2. 仍能按业务需要观察主要模型、来源、状态和延迟，不能通过删除全部维度换取简单实现。
- R3. 为 `gateway_executions`、`gateway_attempts` 明确保留期、批量清理策略、索引影响和失败重试语义。
- R4. 清理任务不得阻塞请求热路径，不得删除仍用于活跃执行、计费核对或故障调查的数据。
- R5. 保留期、合规需求和聚合归档需求在本任务激活前由产品/运维确认。
- R6. 增加指标标签单测、保留策略数据库测试和清理过程可观测性。

## Acceptance Criteria

- [ ] 任意请求模型字符串不会导致无界 Prometheus label cardinality。
- [ ] 执行记录在明确时间窗后可有界清理，活跃与需保留数据不受影响。
- [ ] 清理批次、失败和删除量可观测，数据库负载有上线保护。
- [ ] `pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 替换 Prometheus 或 Gateway 执行日志模型。
- 未经确认永久删除具有合规或计费价值的数据。
