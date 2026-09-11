# 第三轮技术债收敛

## Goal
减少聊天故障误导，并恢复关键数据库读写链路的编译期保护。

## Background
上一轮四批已完成并归档，基线 1ffdcba。剩余项来自归档 technical-debt-audit-v2/audit.md。用户已确认处理聊天加载失败、生成任务生命周期和用量统计。

## Requirements
按顺序执行 chat-load-failures、run-lifecycle-types、usage-query-types。三个子任务分别验收与回滚。核心读取失败不显示正常空会话；两批类型改造保持查询和业务行为。

## Acceptance Criteria
- [ ] 三个子任务各自验收通过；最终 pnpm check、pnpm test 和三个应用构建通过；独立复核与剩余风险有记录。
- [ ] 实现与独立复核分离，记录已验证、未验证和剩余风险。

## Out of Scope
不处理 renderer 字段断言、其他领域类型债、依赖升级、数据库迁移或线上压力测试。真实上游验收不作为本批代码完成条件，不调用生产资源。提交与归档需后续提交计划确认。

## Planning Status
用户已确认实施；代码、自动检查与独立复核完成，详细证据和未验证项见 check.md。尚未提交或归档。
