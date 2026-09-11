# 补齐 PostgreSQL 测试执行入口

## Goal
将遗漏的 analytics 与队列生命周期 PG 检查纳入质量链，降低真实维护风险。

## Requirements
Core PG runner 的固定列表遗漏 analytics.pg.test.ts；根 test:pg 未调用 Worker test:queue-pg。将两项纳入现有隔离数据库流程，不新建测试框架。

## Evidence
apps/web/scripts/test-file-processing-lease-pg.ts:81；packages/core/src/lib/gateway-governance/analytics.pg.test.ts:21；package.json:24；apps/worker/package.json:16；.github/workflows/quality.yml:70

## Acceptance Criteria
- [x] analytics 与 queue lifecycle 不再被根 PG 命令遗漏；增加入口回归检查；保持随机测试库命名、清理与失败退出。
- [x] 实现后独立审阅 diff，记录已验证与未验证项。

## Out of Scope
不改变业务策略，不升级依赖，不删除正常兼容路径。用户已于 2026-09-11 确认父任务最终规划并批准执行。
