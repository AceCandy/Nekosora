# 支持 Responses reasoning.summary

## Goal

让兼容 OpenAI Responses API 的客户端可以通过网关请求推理摘要，不再被入口解析器以 `reasoning.summary` 不受支持为由拒绝。

## Background

- OpenAI Responses API 正式使用 `reasoning.summary` 请求推理摘要，公开值为 `auto`、`concise`、`detailed`。
- 当前 `parseResponses` 已允许 `reasoning.summary` 出现在 allowlist，却在触网上游前显式抛出 `UnsupportedParameterError`：`packages/core/src/lib/protocols/parsers.ts:283-285`。
- 当前依赖 `@ai-sdk/openai@4.0.16` 已支持 `providerOptions.openai.reasoningSummary`，并在 Responses 请求体中生成 `reasoning.summary`。
- 网关的数据流是 `Responses ingress -> IRRequest -> route apiFormat adapter -> upstream`；入口协议不决定上游格式。

## Requirements

- Responses 入口接受且仅接受 `reasoning.summary` 的官方值 `auto`、`concise`、`detailed`。
- 将合法值保存在统一 IR 中，避免在 HTTP handler 或具体 Provider 中重新解析原始请求。
- 对 `openai-responses` 上游路由，通过现有 AI SDK Provider Options 原样转发该值，并继续强制 `store: false`。
- 对其他上游 wire format 静默省略 summary 详细度，不因无法透传该字段而拒绝请求。
- 未传 `reasoning.summary` 时保持现有请求体和路由行为不变。
- 非法值必须在触网上游前以稳定参数路径 `reasoning.summary` 返回 400。
- 不新增依赖、数据库字段或模型目录能力字段。

## Acceptance Criteria

- [x] `reasoning.summary: "auto" | "concise" | "detailed"` 均能通过 Responses 入口解析。
- [x] OpenAI Responses 上游收到相同的 `reasoning.summary` 值以及 `store: false`。
- [x] OpenAI Chat、Anthropic Messages 和 Gemini 上游不收到该字段，请求仍可正常执行。
- [x] 未传 summary 时不额外生成客户端未请求的 summary 参数。
- [x] 非法 summary 值返回 `request.unsupported_parameter`，参数路径为 `reasoning.summary`，且不发起上游请求。
- [x] 现有多协议 parser、路由和生成测试通过。

## Out of Scope

- 新增推理摘要 UI、会话持久化或模型目录能力字段。
- 修改 `reasoning.effort` 档位映射。
- 支持 Responses 的 `store: true`、`previous_response_id`、`conversation` 或其他当前禁用字段。
- 为不同供应商实现摘要详细度的猜测性映射。

## Key Decisions

- 以 route 的 `apiFormat` 判断字段能否表达：`openai-responses` 原样透传，其他格式省略。
- 不新增能力探测、数据库标记或失败后重试；若某条标记为 `openai-responses` 的上游并不兼容官方字段，其错误仍按现有 route 故障转移处理。

## Risks and Deferred Items

- 标记为 `openai-responses` 但不兼容官方 `reasoning.summary` 的非标准上游仍可能拒绝；只有出现真实需求时再评估字段级能力学习。
