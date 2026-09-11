# 恢复路由仓储端到端类型

## Goal
移除路由仓储 Row any 与直接调用方断言，降低真实维护风险。

## Requirements
以现有 Drizzle schema 推导模型、路由及 provider 查询类型，移除 Row any 与 getSchema as any，并同步直接消费者和测试夹具。查询、可见性、子密钥绑定、排序及熔断行为不变。

## Evidence
packages/core/src/lib/repositories/route-repository.ts:13,18,29,47；packages/core/src/lib/routing.ts:133,148

## Acceptance Criteria
- [x] 仓储公开返回值与真实查询匹配；字段错误可被 typecheck 拦截；路由、协议、多模态及流处理测试保持通过；不引入新的 as any 绕过。
- [x] 实现后独立审阅 diff，记录已验证与未验证项。

## Out of Scope
不改变业务策略，不升级依赖，不删除正常兼容路径。用户已于 2026-09-11 确认父任务最终规划并批准执行。
