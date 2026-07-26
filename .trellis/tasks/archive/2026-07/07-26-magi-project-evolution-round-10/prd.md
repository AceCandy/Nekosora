# MAGI 项目进化第 10 轮

## Goal

阻止上游 provider 错误中的 API key、鉴权 header 与敏感 URL query 进入配置探测结果、浏览器响应、console 和持久化错误日志，同时保留可用于排障的状态码与非敏感错误上下文。

## Background

- Gemini 官方探测语义要求把 key 放在 `/models?key=...`，不能改成通用 Authorization header。
- `probeProviderKey()` 当前直接返回 `Error.message`，结果会经 admin/panel Server Action 返回、写入 `lastKeyResults` / `lastModelProbeError` 并在 UI 展示。
- `streamChat()` / `generateChat()` 当前把原始上游错误用于 SSE、console 和 `ops_error_logs.errorMessage`。
- 图像、TTS、STT 适配器持有明文上游 key，但异常未经处理直接进入 API route 的 HTTP、console 和日志路径。
- `toSafeJsonb()` 已按敏感字段名清洗结构化审计数据，但该规则不覆盖字符串中的 URL、header 或 key。

## Requirements

- 建立唯一共享的敏感字段识别与错误文本脱敏实现，支持：调用方提供的精确 secret、敏感 URL query、Bearer/Authorization、`x-api-key` 及常见 JSON/键值形式。
- 精确 secret 必须按字面值替换，不能把 secret 当正则表达式；空 secret 不参与替换。
- Probe 与上游生成调用点必须传入当前实际 API key；provider 自定义 header 值也作为精确 secret，避免非标准鉴权值裸露。
- Stream 的重试、鉴权判断、状态码提取和故障转移继续使用原始错误；只有 console、事件、返回值和落库参数使用脱敏消息。
- 图像、TTS、STT 适配器必须在异常离开持有明文 key 的边界前改写为不携带原始 cause/stack 的安全 Error。
- `logUsage()` 在写 `ops_error_logs.errorMessage` 前执行通用兜底脱敏，防止调用方遗漏。
- `toSafeJsonb()` 复用共享敏感字段规则，并清洗普通字符串及 Error message 中嵌入的凭据；既有截断和序列化行为保持不变。
- 非敏感诊断内容、HTTP status、错误分类短码、重试策略、API 错误结构和成功路径保持不变。

## Acceptance Criteria

- [x] Gemini fetch 错误即使包含完整 `?key=<secret>`，ProbeResult、健康字段和 UI 可见结果也不含 secret。
- [x] 非流式与流式模型探测的 `error` / `nonStreamError` 均不含当前 API key 或敏感自定义 header 值。
- [x] Chat 流式事件、非流式返回、console 和 `ops_error_logs` 不含实际尝试 key；错误分类与故障转移行为不回归。
- [x] 图像、TTS、STT 上游异常在离开适配器前已脱敏，下游 HTTP、任务错误字段、console 与错误日志只能接触安全消息。
- [x] `logUsage()` 会兜底清洗敏感 query/header/键值模式，且不改变普通错误消息。
- [x] 结构化 run/tool 审计继续脱敏敏感字段，并新增对嵌入字符串凭据的保护。
- [x] 定向测试、lint、typecheck、全量测试、生产构建和 diff 检查通过。

## Out Of Scope

- 改变 Gemini `?key=` 请求协议或 provider SDK 的鉴权方式。
- 扫描和清理数据库、日志系统中已经持久化的历史错误文本。
- 修复队列未启动、聊天软删除竞态、MCP 子 key 的知识库授权语义或分享数量上限。
- 对普通业务错误统一隐藏全部上游诊断信息；本轮只移除凭据。

## Risks And Deferred Items

- 未标注、又未作为当前 key/header 值传入的任意随机 secret 无法仅靠文本模式可靠识别；因此必须在持有明文凭据的调用点做精确替换，并保留 sink 兜底。
- 历史记录可能已经包含敏感错误内容；如需清理，应单独设计可审计、可回滚的数据迁移。
- MCP sub key 的 RAG 范围属于产品授权决策，本轮不静默改变。
