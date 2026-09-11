# 恢复生成任务生命周期类型

## Goal
恢复任务与工具调用落库的真实 schema 约束，提前发现字段和状态漂移。

## Background
packages/core/src/lib/chat/run-lifecycle.ts:183-196、210-218、237-253、270-285 使用 getSchema() as any，覆盖启动、续租、终态及工具调用。已有 run-lifecycle.test.ts。

## Requirements
仅收敛 run-lifecycle.ts 及必要直接消费者/测试夹具的类型；复用 getDb/getSchema 推断和表类型。保持严格启动失败禁止上游、续租条件、终态幂等、best-effort 超时/日志和脱敏 JSON 行为，不新增整体强转掩盖错误。

## Acceptance Criteria
- [ ] 目标 schema any 移除；必要字段错误被 typecheck 拦截；启动失败、租约、重复终态、工具调用及脱敏/超时既有测试通过；无运行时语义变更。
- [ ] 实现与独立复核分离，记录已验证、未验证和剩余风险。

## Out of Scope
不处理 renderer 字段断言、其他领域类型债、依赖升级、数据库迁移或线上压力测试。真实上游验收不作为本批代码完成条件，不调用生产资源。提交与归档需后续提交计划确认。

## Planning Status
用户已确认实施；代码、自动检查与独立复核完成，详细证据和未验证项见 check.md。尚未提交或归档。
