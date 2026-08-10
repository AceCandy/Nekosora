# Gateway 请求流量治理

## Goal

为公网 `/v1/*` 建立按 API Key/用户执行的多实例一致资源边界，限制突发请求、并发流和可计费消耗。

## Background

- `packages/core/src/lib/protocols/handler.ts:25-36` 在认证与解析后直接进入响应编码链路。
- `apps/gateway/src/handlers.ts:38-56` 直接映射 `/v1/*` handler；仓库检索未发现按 `apiKeyId`/用户执行的限流、配额或并发拒绝策略。

## Requirements

- R1. 在鉴权成功、调用上游之前执行按 `apiKeyId` 与用户归属的限流和并发检查。
- R2. 多 Gateway 实例下计数必须原子且可恢复，进程退出、客户端断开和异常终态都要释放并发租约。
- R3. 超限响应保持 OpenAI 兼容的 HTTP 状态和错误体，明确区分速率、并发与配额原因，并提供合理 `Retry-After`。
- R4. 策略应覆盖流式与非流式端点，不能只限制请求建立而忽略长连接占用。
- R5. 管理配置、默认阈值、主 Key/子 Key 继承关系和配额周期在本任务激活前完成产品决策。
- R6. 指标和日志只记录必要标识，不记录原始 API Key；测试覆盖并发竞争、异常释放、窗口切换和多实例语义。

## Acceptance Criteria

- [ ] 无外部 WAF 时，单个 Key 也不能无限建立请求或流式连接。
- [ ] 超限不会调用 Provider，正常请求和现有鉴权行为不受影响。
- [ ] 多实例测试证明计数原子、租约可回收、重启后不会永久占额。
- [ ] `pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 账单支付系统或套餐营销功能。
- 将上游 Provider 的 429 当作客户端配额状态。
