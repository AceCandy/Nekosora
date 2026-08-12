# 熔断降级策略加固

## Goal

在所有 Provider 路由均被熔断时快速、明确地拒绝请求，同时保留单个受控恢复探针，避免故障流量通过 fail-open 回退重新冲击上游。

## Background

- `packages/core/src/lib/circuit-breaker.ts:67-80` 在冷却到期时直接把 Provider 转为 `half-open` 并占用唯一探针。
- `packages/core/src/lib/routing.ts:184-194` 在全部路由被拒绝时返回原始全集，会重新执行 `open` 或探针已占用的 Provider。
- 当前探针只有成功和可转移失败会回报；取消、确定性请求错误、adapter 拒绝、无 Key 或 Provider-start 失败可能让 Provider 长期停留在 `half-open`。
- 当前只有 `routing.no_route`，无法区分“没有配置路由”和“存在路由但全部不健康”。

## Requirements

- R1. 熔断判断必须明确区分 `closed`、仍在冷却的 `open`、可获取的恢复探针和已占用探针，不用空路由数组承载多种含义。
- R2. 同一 Provider 同时最多存在一个 half-open 探针许可；许可覆盖一次有界的路由执行，并在成功、失败、超时、取消和所有未触网上游的终态可靠释放。
- R3. Provider 成功使探针恢复为 `closed`；可转移失败或 Provider 超时使探针重新 `open` 并刷新冷却；没有健康结论的终态不得误判成功或增加失败计数，释放后保持可再次探测。
- R4. 所有候选路由均为 `open` 或探针已占用时，不得返回原始路由全集，也不得调用上游；返回稳定的 `routing.no_healthy_route`、HTTP 503。
- R5. 有其他健康 Provider 时继续沿用现有 priority、weight、Key 重试和 route failover 顺序；确定性请求错误、协议/能力拒绝和客户端取消继续不污染 Provider 失败计数。
- R6. 错误响应、低基数指标和 gateway execution 事实必须能把“无健康路由”与普通上游失败区分开，不记录 Provider ID、route ID、模型名或 Key 等高基数/敏感标签。
- R7. 进程内熔断仍为当前边界；本任务不引入跨实例协调。

## Acceptance Criteria

- [ ] 单 Provider 或多 Provider 全部不健康时，上游 adapter 调用数为 0，四种 Chat 协议及 Image/TTS/STT 最终均映射为 `routing.no_healthy_route`、HTTP 503。
- [ ] 冷却边界的并发请求只有一个获得同一 Provider 的恢复许可；其他请求使用健康备用 Provider，或在没有备用时返回无健康路由。
- [ ] 探针成功恢复 `closed`；可转移失败和 Provider 超时重新 `open` 并刷新冷却。
- [ ] 取消、确定性请求错误、adapter/能力拒绝、空 Key 和 Provider-start 失败都会释放探针，且不把 Provider 标记为健康或新增失败。
- [ ] 正常 closed Provider 的 priority/weight、Key 重试、route failover、提交后停止和错误分类行为保持现状。
- [ ] Prometheus 使用固定低基数事件区分无健康路由和探针终态；`gateway_executions.error_code` 记录稳定错误码，且无额外原始错误或凭据日志。
- [ ] 熔断、路由、Engine、错误映射、指标和跨协议定向测试通过；`pnpm check`、`pnpm test`、Web/Gateway 构建通过。

## Out Of Scope

- 跨进程共享熔断状态。
- 改写路由优先级和权重算法。
- 自动重试已被无健康路由拒绝的整个客户端请求。
- 为 503 增加 `Retry-After`；探针占用没有可靠的完成时间，不能提供一致等待值。
- 管理端页面、暗色主题或 custom renderer 行为变更。
