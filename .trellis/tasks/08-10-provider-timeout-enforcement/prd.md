# Provider 超时强制执行

## Goal

让 Provider 的连接、读取和流空闲超时配置真正约束所有上游模型请求，避免慢连接或停滞流无限占用 Gateway/Web 资源。

## Background

- `packages/db/src/schema.ts:207-209` 定义三类超时。
- `packages/core/src/lib/routing.ts:39-52` 只映射连接和读取超时；`packages/core/src/lib/providers/registry.ts:60-90` 构造实际 SDK Provider 时未消费这些字段。
- 当前执行链只可靠传播客户端取消信号，不能据此认为 Provider 超时已经生效。

## Requirements

- R1. 明确定义 `connectTimeoutMs`、`readTimeoutMs`、`streamIdleTimeoutMs` 的起止语义，并对所有支持协议保持一致。
- R2. 三类超时必须进入实际 fetch/stream 执行链路；仅存在于 DB、类型或 `ResolvedProvider` 不算生效。
- R3. 超时触发后必须中止上游请求、释放 reader/listener，并进入现有错误分类、故障转移、熔断和执行记录链路。
- R4. 客户端主动取消、服务关闭 drain 与超时信号组合后仍保持正确取消原因和清理顺序。
- R5. 未配置超时时保持明确且有测试的默认行为；默认值与允许范围在本任务激活前确定。
- R6. 单元测试使用可控时钟/流覆盖连接前停滞、首字节后停滞、持续有 chunk、客户端先取消和 fallback route。

## Acceptance Criteria

- [ ] 三个配置字段均有真实执行层消费者和协议矩阵测试。
- [ ] 超时请求不会继续占用连接或在后续写入重复终态。
- [ ] 管理配置、运行时类型、日志和文档对超时语义描述一致。
- [ ] `pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 替换 AI SDK 或 HTTP 客户端。
- 在本任务中实现客户端 API Key 限流。
