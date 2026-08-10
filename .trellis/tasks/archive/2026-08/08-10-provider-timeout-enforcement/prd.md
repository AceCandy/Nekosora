# Provider 超时强制执行

## Goal

让 Provider 的连接、总读取和流空闲超时配置真正约束所有上游模型请求，避免慢连接或停滞流无限占用 Gateway/Web 资源，同时不破坏客户端取消、故障转移和流式提交边界。

## Background

- `packages/db/src/schema.ts:207-209` 与 PostgreSQL 基线迁移已经定义三个可空字段，但没有默认值和范围约束。
- `packages/core/src/lib/providers/types.ts:28-32` 与 `packages/core/src/lib/routing.ts:39-52` 只传播连接和读取超时，流空闲超时在进入执行层前已经丢失。
- `packages/core/src/lib/providers/registry.ts:36-42` 的自定义 fetch 只覆盖 User-Agent；管理 action、Provider 表单、媒体适配器和 hosted Provider search 均未消费三类超时。
- `packages/core/src/lib/gateway-execution/engine.ts:115-290` 已经拥有 route/key attempt、客户端取消、响应提交、故障转移、breaker 和 telemetry 的唯一状态机，Provider 超时必须进入该状态机，不能另建一套重试逻辑。
- 当前只有 Provider discovery 等局部路径存在独立固定预算；它们不等于 Provider 配置已经生效。完整证据见 `research/timeout-execution-boundary.md`。

## Confirmed Decisions

- 空值使用系统默认值：`connectTimeoutMs=60_000`、`readTimeoutMs=900_000`、`streamIdleTimeoutMs=120_000`。
- 允许范围分别为：连接/响应头 `1_000..300_000ms`、总读取 `10_000..3_600_000ms`、流空闲 `5_000..900_000ms`。
- `0` 和负数不表示禁用；三类超时始终存在硬上界。管理员需要更宽松行为时只能调高到允许上限。
- 管理表单以秒为单位展示和输入，持久化与运行时继续使用毫秒。空白保存为 `null`，运行时解析为对应系统默认值。

## Requirements

- R1. `connectTimeoutMs` 定义为实际发起上游 fetch 到收到响应头的最长时间；受 portable Fetch API 限制，不把它描述为纯 TCP 握手超时。
- R2. `readTimeoutMs` 定义为一次上游 attempt 从开始到完整消费响应体的总时限；`streamIdleTimeoutMs` 定义为流读取期间相邻上游 chunk 的最长间隔，并在每个 chunk 后重置。
- R3. 三类超时必须进入实际 fetch/stream 执行链路，覆盖 OpenAI Chat、OpenAI Responses、Anthropic Messages、Gemini GenerateContent、hosted Provider search、图像、语音合成、语音转写和 Provider discovery。仅存在于 DB、类型或 `ResolvedProvider` 不算生效。
- R4. Provider 超时使用稳定的 `gateway.timeout` 错误语义：响应提交前可进入现有 key/route fallback 与 breaker；响应提交后不得切换上游，只结束当前流且只写一次终态。
- R5. 客户端主动取消和服务关闭 drain 继续记为 `interrupted`，不更新普通 Provider failure；与 Provider timeout 竞争时保留最先发生的原因，并清理 timer、listener、iterator/reader。
- R6. 未配置字段使用明确的系统默认值，不保留无限等待；默认值、允许范围和是否支持显式禁用必须在本任务激活前确定。
- R7. 管理端以带单位的数值输入配置三类超时，创建、更新、回显、清空、服务端范围校验和中英文说明保持一致。
- R8. 单元测试使用可控时钟/流覆盖响应头前停滞、总读取超时、首 chunk 后停滞、持续有 chunk、客户端先取消、timeout 先发生、fallback route、已提交流和资源清理。

## Acceptance Criteria

- [x] 三个配置字段均有真实执行层消费者，所有上游模型请求路径均使用同一 timeout policy，并有四种 Chat wire format 与媒体路径测试。
- [x] Provider timeout 记录为 `gateway.timeout`；提交前按既有规则 fallback 并更新 breaker，提交后不切换上游。
- [x] 客户端取消仍记录为 `interrupted`，不会被 Provider timeout 误分类，也不会重复写 attempt/final execution 终态。
- [x] 超时请求会中止上游并释放 timer、listener、iterator/reader；持续收到 chunk 的长流不会被 stream-idle watchdog 误杀。
- [x] 管理配置、运行时类型、错误日志、安全脱敏和文档对三类超时语义与单位描述一致。
- [x] `pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 替换 AI SDK 或 HTTP 客户端。
- 在本任务中实现客户端 API Key 限流。
- 使用 Node/Undici 私有 API 实现传输层 TCP-only connect timeout；本任务保持 Web Fetch 兼容语义。
