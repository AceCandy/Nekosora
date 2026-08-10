# 熔断降级策略加固

## Goal

在所有路由均不可用时维持可控恢复能力，同时不再通过返回原始路由全集绕过 open/half-open 保护。

## Background

- `packages/core/src/lib/circuit-breaker.ts:67-80` 约束 half-open 只允许一个探针。
- `packages/core/src/lib/routing.ts:184-194` 在所有路由被拒绝时有意返回原始全集，导致故障条件下重新访问 open/已占用 half-open Provider。

## Requirements

- R1. 明确区分 closed、open、可获得的 half-open 探针和已占用探针，不以空数组统一表示不同状态。
- R2. 同一 Provider 的 half-open 探测并发必须受单租约约束；探测完成、超时或取消后可靠释放。
- R3. 所有路由熔断时不得无界放行全集；无探针资格的请求应快速返回稳定、可观测的暂不可用错误。
- R4. 多路由、多 Provider、单 Provider 和并发恢复场景均有确定测试，保留现有正常故障转移顺序。
- R5. 进程内熔断仍为当前边界；是否升级为分布式状态不在本任务范围。

## Acceptance Criteria

- [ ] open/half-open Provider 不会因 `allowed.length === 0` 被批量重新执行。
- [ ] 冷却后只有受控探针访问上游，成功/失败分别恢复或重新熔断。
- [ ] 错误、指标和日志能区分“无健康路由”与普通上游失败。
- [ ] 定向并发测试、`pnpm check`、`pnpm test` 通过。

## Out Of Scope

- 跨进程共享熔断状态。
- 改写路由优先级和权重算法。
