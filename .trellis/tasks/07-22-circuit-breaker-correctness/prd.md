# 修正 provider 熔断状态机与失败计数

## Goal

让 provider 熔断器严格执行既有 closed/open/half-open 契约，避免冷却窗口并发冲击上游，并确保可转移的终端路由失败也能更新 provider 健康状态。

## Background

- `circuit-breaker.ts:isProviderAllowed()` 将 open 转为 half-open 后，后续调用仍返回 `true`；隔离复现得到 `firstProbe=true`、`secondProbe=true`，与“只放一次试探”注释冲突。
- `stream.ts` 的流式和非流式路径都在判断“还有下一条路由”之后才调用 `recordFailure()`，因此唯一或最后一条路由的可转移失败不会计数。
- 当前 `pnpm typecheck` 和 324 个测试通过，但没有熔断状态机专项测试；lint 有 3 条既有 warning。

## Requirements

- R1：open 冷却到期后，只允许第一个调用进入 half-open 探测；探测结果回报前，后续调用必须拒绝。
- R2：half-open 探测成功后恢复 closed；失败后立即重新 open 并刷新冷却时间。
- R3：流式与非流式生成中，只要路由错误可故障转移，就必须调用一次 `recordFailure()`，不受该路由是否为最后一条影响。
- R4：确定性请求错误继续停止转移，且不得计入 provider 熔断状态。
- R5：保留“所有候选路由均不可用时返回原始全集”的既有降级策略，不调整公共接口或环境变量。
- R6：改动仅限熔断实现、生成调用点及其自动化测试；不处理其他 lint warning 或文件预览问题。

## Acceptance Criteria

- [x] AC1：自动化测试证明第一次 half-open 探测返回 `true`，结果回报前第二次返回 `false`。
- [x] AC2：自动化测试覆盖 closed -> open -> half-open -> closed 与 half-open -> open 两条状态路径。
- [x] AC3：自动化测试或可观测测试接缝证明可转移的最后/唯一路由失败会被记录，确定性错误不会被记录。
- [x] AC4：流式与非流式路径采用相同的失败上报顺序。
- [x] AC5：`pnpm lint`、`pnpm typecheck`、相关测试与全量 `pnpm test` 均无新增失败；既有 warning 单独报告。
- [x] AC6：`git diff --check` 通过，独立复核未发现超出任务范围的改动。

## Out of Scope

- 跨进程或 Redis 共享熔断状态。
- 修改阈值、冷却时间或环境变量解析规则。
- 取消全部熔断时的降级放行策略。
- 清理既有 lint warning、优化文件预览或改变前端显示。
