# 修复 MCP 连接超时资源泄漏

## Goal

确保 MCP stdio、SSE 与 Streamable HTTP 连接超时后主动取消初始化并关闭底层 transport，避免调用方已降级到缓存工具后，后台连接仍继续运行或泄漏进程/网络句柄。

## Background

- `registry.ts#connectWithTimeout` 使用 `Promise.race` 在 5 秒后拒绝，但不取消 `buildConnector`。
- MCP SDK 的 SSE `start()` 会等待连接，stdio 会启动子进程，Streamable HTTP 初始化会发起 fetch；当前超时分支都拿不到 handle，因此无法调用 `close()`。
- SDK `Client.connect(transport, options)` 接受 `AbortSignal`，初始化失败时会关闭 client；三种 transport 均实现 `close()`，可分别终止 EventSource/fetch/子进程。
- `src/lib/mcp/registry.ts` 当前没有对应单测。

## Requirements

- R1：连接超时必须继续以 `mcp_connect_timeout` 稳定错误结束，不改变上层缓存工具降级行为。
- R2：超时发生时必须触发 AbortSignal，并主动调用底层 transport `close()`。
- R3：连接在超时前成功时必须清理定时器，不得关闭有效 transport。
- R4：连接自身的鉴权、网络或协议错误必须原样传播，不得误报为超时。
- R5：stdio 成功连接仍进入现有 pool；SSE/HTTP 成功连接及调用后关闭语义保持不变。

## Acceptance Criteria

- [x] AC1：单测证明超时 promise 以 `mcp_connect_timeout` 拒绝，AbortSignal 已触发且 transport `close()` 恰好调用一次。
- [x] AC2：单测证明超时前成功返回、定时器清零且 transport 不关闭。
- [x] AC3：单测证明普通连接错误保持原错误，定时器清零且不触发超时关闭。
- [x] AC4：`registry.ts` 三种 connector 都经同一超时/取消机制调用 SDK `Client.connect`。
- [x] AC5：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。
- [x] AC6：没有新增依赖、临时文件或服务进程残留。

## Out of Scope

- 调整 MCP 连接超时时长或新增配置项。
- 改造 stdio pool 的淘汰策略。
- 为 MCP registry 的数据库查询或工具名路由补全所有测试。
