# 恢复用量统计查询类型

## Goal
恢复统计查询和 DTO 的类型保护，减少过滤与字段变更时的维护风险。

## Background
packages/core/src/lib/usage-aggregate.ts:42,52,197,219,261,283 使用 schema any、DTO any 与 rowsRaw as any[]。buildUsageWhere:199-211 有成功过滤、用户隔离和时间范围条件。已有 usage-aggregate.test.ts。

## Requirements
收敛 usage-aggregate.ts 及必要直接消费者和测试夹具，保持成功状态过滤、用户隔离、时间范围、聚合与 Number 转换、排序和分页原语义。不得用静态 SQL 类型假装已做运行时数值转换。

## Acceptance Criteria
- [ ] 目标 schema/DTO any 移除；时间序列、模型/来源分布、列表/count 过滤一致、用户隔离、空结果和数值转换测试通过；字段漂移可被类型检查拦截。
- [ ] 实现与独立复核分离，记录已验证、未验证和剩余风险。

## Out of Scope
不处理 renderer 字段断言、其他领域类型债、依赖升级、数据库迁移或线上压力测试。真实上游验收不作为本批代码完成条件，不调用生产资源。提交与归档需后续提交计划确认。

## Planning Status
用户已确认实施；代码、自动检查与独立复核完成，详细证据和未验证项见 check.md。尚未提交或归档。
