# 多协议双向网关技术设计

## 1. 设计目标与边界

核心机制只有一条：协议差异只存在于网关两端，中间继续使用现有统一路由与执行引擎。

```text
HTTP Request
  -> ingress auth + protocol parser
  -> CanonicalRequest
  -> resolveRoutes / executeGateway
  -> route apiFormat adapter
  -> upstream native API
  -> CanonicalEvent stream
  -> ingress protocol encoder
  -> HTTP JSON / SSE
```

不为四种协议各写一套路由循环。`executeGateway` 继续独占 route/key 遍历、重试、熔断、Abort、提交状态、遥测和错误脱敏；parser、adapter、encoder 只负责边界翻译。

## 2. Route 级 API 格式

### 2.1 数据类型

新增独立 PostgreSQL enum `route_api_format`，避免把 Provider 连接类型与 wire protocol 混为一谈：

```text
openai-chat
openai-responses
anthropic-messages
gemini-generate-content
openai-images
openai-audio-stt
openai-audio-tts
```

`routes.api_format` 为 `NOT NULL`、无静态默认值。后三类媒体值只用于保证共享 routes 表迁移完整，不改变本任务范围外的媒体执行逻辑。

`ProviderProtocol` 保持现有枚举，作为 Provider 创建时的默认连接类型、默认 Base URL 和 `/models` 探测依据。新增 `RouteApiFormat` 作为 route、运行时和 UI 的共享类型。

### 2.2 存量回填

迁移按关联 Provider 精确回填：

| `providers.protocol` | `routes.api_format` |
| --- | --- |
| `openai` | `openai-chat` |
| `openai-compatible` | `openai-chat` |
| `anthropic` | `anthropic-messages` |
| `gemini` | `gemini-generate-content` |
| `openai-images` | `openai-images` |
| `openai-audio-stt` | `openai-audio-stt` |
| `openai-audio-tts` | `openai-audio-tts` |

迁移顺序：创建 enum，新增 nullable 列，`UPDATE ... FROM providers` 回填，断言无 null，再设 `NOT NULL`。同步新的 PostgreSQL migration、`meta/_journal.json` 和 snapshot。

### 2.3 写入和解析

- 管理员与用户 route 表单显式保存 `apiFormat`。
- 新建和快速挂载缺省使用 Provider protocol 对应的兼容格式，但服务端仍显式写入，不依赖 DB default。
- 更新 action 只有在 `FormData` 含 `apiFormat` 时才修改，避免旧调用方覆盖已存值。
- 服务端校验 chat 模型只能选择四种 chat 格式，媒体模型只能保留对应媒体格式。
- `ResolvedProvider.protocol` 保留；`ResolvedRoute.apiFormat` 决定 operation 对应的上游 adapter。现有含糊的 `ResolvedRoute.protocol` 改名或停止作为 wire protocol 使用，避免两个事实源。
- Chat operation 的 registry 只接受四种 chat 格式；Image、STT、TTS 继续由现有 media registry 选择 adapter，只接受各自的 `openai-images`、`openai-audio-stt`、`openai-audio-tts`。媒体执行链不调用 chat model factory。
- repository 与 `ResolvedRoute` 对所有七种值完整传递；媒体 route 的创建、快速挂载、解析和首 key/route 故障转移必须有回归测试，证明迁移未改变既有行为。

## 3. 统一请求与事件

### 3.1 CanonicalRequest

在 `packages/core/src/lib/providers/types.ts` 或同层协议模块定义显式类型，删除依赖 `[key: string]: unknown` 的透传行为：

```text
CanonicalRequest
  model
  messages[]
    role: system | developer | user | assistant | tool
    content[]: text | image | tool-call | tool-result
  stream
  temperature / topP / maxOutputTokens / stop
  tools[]: name / description / inputSchema
  toolChoice: auto | none | required | named
  responseFormat: text | json-schema
  reasoning: off | minimal | low | medium | high | xhigh | max
```

工具参数在解析边界校验为合法 JSON；内部同时保留稳定的 `toolCallId`、工具名和结构化参数。图片统一为 URL 或 data URL，不在首期下载、上传或创建文件对象。

现有 WebChat 使用的 `IRRequest` 通过同一规范化函数进入 `CanonicalRequest`，避免维护第二套生成核心。名称是否保留为 `IRRequest` 属于实现细节，但最终只能有一个请求语义事实源。

### 3.2 CanonicalEvent

统一流事件覆盖协议 encoder 所需的最小生命周期：

```text
response-start
text-delta
reasoning-delta
tool-call-start
tool-call-delta
tool-call-end
usage
finish
error
```

每次请求在进入执行链时生成一次稳定 response id；工具调用保留稳定 item/call id。`tool-call-delta` 保存 JSON 字符串增量，避免等待完整参数后才伪造流式结果。非流式响应由同一个 collector 聚合 `CanonicalEvent`，不另写生成路径。

对 WebChat agent loop 仍可保留 `tool-result` 内部事件，但对外 Gateway 不执行调用方提供的函数，只把 tool call 返回客户端。

## 4. Ingress Parser 与鉴权

### 4.1 路由注册

`GATEWAY_ROUTES` 注册四种协议、五个 HTTP 路径。Gemini 的字面冒号使用当前 Fastify/find-my-way 支持的双冒号语法：

```text
/v1beta/models/:model::generateContent
/v1beta/models/:model::streamGenerateContent
```

Fastify 已把 `request.params` 传入 handler，不新增手写路由器。Gemini path 中的模型是请求模型事实源；body 不得提供冲突模型。

### 4.2 共享鉴权

提取一个小型 `authenticateGatewayRequest`：

- OpenAI：Bearer。
- Anthropic：`x-api-key` 或 Bearer。
- Gemini：`x-goog-api-key` 或 Bearer。
- 两个头同时存在且值不同：401。
- Gemini URL 存在任何 `key` 查询参数：在解析或记录 raw URL 前返回 400；日志只使用规范化 route path。

仍复用现有 `verifyKey`、错误码和调用上下文，不改变 owner-only 模型可见性与子 Key 绑定规则。

### 4.3 严格参数策略

每个 parser 拥有该协议的顶层和嵌套 allowlist。校验顺序固定为：JSON/路径结构、状态参数、显式禁用能力、字段类型、规范化语义。首个不支持字段抛出：

```text
UnsupportedParameterError {
  parameter: "input[0].content[1].type"
  message: "Unsupported parameter: 'input[0].content[1].type'."
}
```

关键规则：

- Chat 的 `n`、Gemini `candidateCount` 缺省或为 1；大于 1 拒绝。
- Responses `store` 缺省或 false；所有持久状态字段拒绝。
- 自定义 function tools 可用；web/file/computer/code execution 等内置工具拒绝。
- `logprobs`、音频、文件、专有缓存字段拒绝。
- 数值 thinking budget 不做猜测；只有协议字段能无歧义映射到目录档位时才接受。
- 未在 allowlist 中的未知字段也返回同一 400，不能落入原始字段透传。

## 5. 上游 Adapter Registry

新增一个集中 chat registry，以 `route.apiFormat` 选择已安装 AI SDK provider：

| Route API format | SDK model | Base URL 追加路径 |
| --- | --- | --- |
| `openai-chat` | 官方 Provider 用 `createOpenAI().chat`；兼容 Provider 用 `createOpenAICompatible().chatModel` | `/chat/completions` |
| `openai-responses` | `createOpenAI().responses` | `/responses` |
| `anthropic-messages` | `createAnthropic().messages` | `/messages` |
| `gemini-generate-content` | `createGoogle()(model)` | SDK 的 `models/{model}:generateContent` / stream 路径 |

沿用现有 AI SDK 作为出站协议实现，不新增 HTTP 客户端或第二套重试。所有调用保持 `maxRetries: 0`，重试只归现有 gateway engine 管理。

`openai-chat` 唯一需要同时参考 Provider protocol：官方 OpenAI 使用官方 chat model 以保留 developer/reasoning 语义，`openai-compatible` 使用 compatible model 以保留现有 system role 和兼容请求变换。其他三种格式完全由 route 格式决定。

Chat registry 遇到三个媒体格式时返回 operation-incompatible rejected result，不构造 LanguageModel。Image/TTS/STT 的 operation registry 同理拒绝四种 chat 格式；它们继续复用现有 media adapter 和 engine，不属于 4 x 4 聊天矩阵。

Provider 自定义 headers 先过滤认证头，再由 SDK 注入当前选中的 Key：

- OpenAI：`Authorization: Bearer`
- Anthropic：`x-api-key`
- Gemini：`x-goog-api-key`

Route headers 与 Provider headers 的既有合并缺口在此处补齐，合并顺序为 Provider headers < route headers < adapter 必需 headers；任何层都不能覆盖认证凭据。

## 6. Route 兼容与模型能力

请求级能力先由 `model_catalog` 校验：vision、tools、reasoning、thinkingFormat、thinkingLevelMap 等不在 parser 或 adapter 中按名称猜测。

出站序列化分两种失败：

1. 请求本身不受支持：ingress parser 直接返回 400，不解析 route。
2. 某条 route 的格式无法表达已规范化语义：`selectAdapter` 产生带 `parameter` 的 rejected attempt，不访问上游、不更新 breaker，继续下一 route。

至少一条兼容 route 成功时正常返回。所有 route 都因同一参数不兼容时，执行链返回确定性 `unsupported_parameter`，由入口 encoder 转为 HTTP 400。这复用 `executeGateway` 已有的 rejected-route 边界，同时保留故障转移价值。

### 6.1 公共语义能力矩阵

`支持` 表示 wire protocol 有明确字段，且仍需通过 `model_catalog` 的模型能力检查；`拒绝` 表示该 route 在访问上游前返回表中参数路径。16 组合矩阵以纯文本作为全部成功基线，其他能力按下表断言成功或 400，不能为了让矩阵全绿而伪造语义。

| Canonical 语义 | OpenAI Chat | Responses | Anthropic Messages | Gemini | 不兼容参数 |
| --- | --- | --- | --- | --- | --- |
| 普通文本/system/user/assistant | 支持 | 支持 | 支持 | 支持 | - |
| `developer` 独立优先级 | 官方 OpenAI 支持；compatible route 拒绝 | 支持 | 拒绝，不合并冒充 system | 拒绝，不合并冒充 system | `messages[i].role` |
| 图片输入 | 支持 | 支持 | 支持 | 支持 | `messages[i].content[j].type` |
| 自定义 function/tool result | 支持 | 支持 | 支持 | 支持 | `tools` 或具体 content path |
| `toolChoice` auto/none/required/named | 支持 | 支持 | 支持原生等价值 | 支持原生 mode/allowed names | `tool_choice` |
| JSON Schema 输出 | 原生 `response_format` | 原生 `text.format` | 原生 `output_config.format` | 原生 response schema | `response_format` |
| 推理开关/档位 | 目录映射支持才发送 | 目录映射支持才发送 | 目录映射到原生 thinking/effort 才发送 | 目录映射到原生 thinking config 才发送 | 对应入口 reasoning/thinking path |
| 公共 usage/finish | 支持 | 支持 | 支持 | 支持 | 未知 finish reason 转终端错误 |

OpenAI-compatible Chat 不发送 developer role；JSON Schema 和推理字段由 route format、Provider protocol 和 `model_catalog` 的明确映射共同决定，不能按 URL 猜测。Anthropic JSON Schema 强制使用已安装 SDK 的原生 `structuredOutputMode=outputFormat`，禁止回退为 `jsonTool` 模拟。数值预算、未验证 schema 模式或无法等价的 role 都走 rejected route。

### 6.2 Rejected route 契约

`selectAdapter` 从 nullable 返回值升级为明确联合类型：

```text
{ kind: "selected", adapter }
{ kind: "rejected", error: SafeGatewayError(request.unsupported_parameter), parameter }
```

- rejected attempt 以 `status=rejected`、`errorPhase=request`、统一错误码和无凭据 route snapshot 写遥测；不访问网络、不轮换该 route 的 Key、不更新 breaker。
- engine 继续下一条 route。只要有真实上游 attempt，最终结果按真实 attempt 的既有优先级收敛。
- 如果没有任何上游 attempt 且所有 route 都 rejected，final execution 使用有序第一条 rejection 的错误码和 parameter，状态由 `ERROR_META` 映射为 400。
- 流已经提交后不得再出现 route rejection；adapter 的可表达性检查必须在第一次上游请求前完成。

## 7. Response Encoder

四个协议 encoder 只消费 `CanonicalEvent`；Gemini 普通和流式两个 HTTP 路径复用同一个 Gemini encoder 的不同输出模式：

- Chat Completions：保持 `chat.completion` / `chat.completion.chunk`、tool_calls delta、usage 和 `[DONE]`。
- Responses：生成 `response.created`、output item/content part 生命周期、文本/推理/tool argument delta 和 `response.completed`。
- Anthropic：生成 message JSON 或 `message_start`、`content_block_*`、`message_delta`、`message_stop` 事件。
- Gemini：生成 `GenerateContentResponse` JSON；流式路径输出 Gemini SSE chunk，不使用 OpenAI `[DONE]`。

统一 finish reason 只映射有明确等价关系的值：

| Canonical | Chat | Responses | Anthropic | Gemini |
| --- | --- | --- | --- | --- |
| `stop` | `stop` | completed | `end_turn` | `STOP` |
| `length` | `length` | incomplete/max tokens | `max_tokens` | `MAX_TOKENS` |
| `tool-calls` | `tool_calls` | completed + function_call | `tool_use` | `STOP` + functionCall |
| `content-filter` | `content_filter` | incomplete/content filter | error | `SAFETY` |

未知或无法表达的终止原因不能伪装为正常 `stop`。非流式返回安全上游错误；已开始的流使用入口协议的 error 终端事件。

usage 统一保存 input/output/total/reasoning/cached token。目标协议没有对应字段时省略该细分项，绝不填 0 冒充真实值。

## 8. 错误协议

新增 `ErrorCode.REQUEST_UNSUPPORTED_PARAMETER = "request.unsupported_parameter"`，并同步 `ERROR_META`、中英文错误字典和 `routingCodeToErrorCode`/gateway 映射。`ERROR_META` 固定为 HTTP 400 + `invalid_request_error`；准确的英文参数文本通过现有 `messageOverride` 生成，结构化参数放在 `details.parameter`。

内部只跨边界传 `ErrorCode`、已脱敏 message/details 和 `SafeGatewayError`。HTTP status 始终从 `ERROR_META[code]` 取得，协议 encoder 不自行决定状态码，只把同一内部错误编码为外部 envelope：

- OpenAI Chat/Responses：`{ error: { message, type, param, code } }`
- Anthropic：`{ type: "error", error: { type, message } }`
- Gemini：`{ error: { code: 400, message, status: "INVALID_ARGUMENT" } }`

对 Unsupported parameter，OpenAI 外部 `type=invalid_request_error`、`code=request.unsupported_parameter`、`param=<路径>`；Anthropic/Gemini 的 message 保留相同英文文本，内部稳定码与 parameter 进入安全结构化 details/遥测。

这会更新 `.trellis/spec/backend/error-handling.md` 的 `/v1/*` envelope 规则：OpenAI 入口继续使用现有统一 envelope；Anthropic/Gemini 原生入口允许协议 encoder 改变 body 形状，但错误码、文案、status、脱敏和分类仍只有 `lib/errors.ts` 一个事实源。

上游 raw body、URL、headers 和 Key 不得离开 execution engine 安全域。错误分类、脱敏、attempt/final telemetry 继续走现有实现。

## 9. 流、取消与故障转移

- handler 将 `req.signal` 与 `ReadableStream.cancel()` 合并后传给 `streamChat`；非流式也传递相同 signal。
- Abort 立即停止，不重试、不故障转移、不记普通失败。
- `text-delta`、`reasoning-delta`、`tool-call-start/delta/end` 都是不可撤回事件，yield 前标记响应已提交。
- 提交前可切换 Key/route；提交后任何错误都只编码为当前客户端协议的终端错误，禁止拼接备用上游。
- 入口 encoder 必须在消费 finish/error 后继续完成 iterator cleanup，确保 usage 与 telemetry finally 执行。
- 测试覆盖自然 finish、流式 error、setup 期间 cancel、生成期间 cancel 和永不返回的 provider iterator；断言 cleanup/usage/telemetry finally 恰好一次。取消后的五个 HTTP 路径均不得再写 chunk、error、协议终止标记、`[DONE]` 或显式 close。

## 10. Base URL 与探测

Base URL 规范为 API 根地址，保留必要版本前缀并去掉尾部 `/`，不剥离用户自定义 path。例如：

```text
OpenAI-compatible: http://192.168.1.205:3500/v1
Gemini:            https://generativelanguage.googleapis.com/v1beta
```

Provider 创建/更新在服务端拒绝明显的具体生成 endpoint 后缀，如 `/responses`、`/messages`、`/chat/completions` 和 `:generateContent`，错误提示用户填写 API 根地址。UI 同时展示由所选 route `apiFormat` 计算的实际 endpoint 预览。

| 格式/操作 | Base URL 示例 | adapter 追加内容 |
| --- | --- | --- |
| OpenAI Chat | `https://host/v1` | `/chat/completions` |
| OpenAI Responses | `https://host/v1` | `/responses` |
| Anthropic Messages | `https://host/v1` | `/messages` |
| Gemini 非流式 | `https://host/v1beta` | `/models/{model}:generateContent` |
| Gemini 流式 | `https://host/v1beta` | `/models/{model}:streamGenerateContent`，SDK 使用 SSE 所需 `alt=sse` query |

fake upstream 必须记录并断言尾斜杠、版本前缀、编码后的 model、Gemini stream query 和 endpoint-style Base URL 拒绝；不依赖字符串快照推测 SDK 行为。

探测职责拆分：

- Provider Key 与模型列表探测沿用 Provider protocol，`/models` 只拼一次。
- `testRoute` 和模型可用性探测使用 route `apiFormat`，通过同一 adapter registry 发最小无状态请求。
- Responses 探测显式 `store:false`；所有 SDK retry 关闭。

## 11. 管理界面

RouteFormDialog 增加“上游 API 格式”选择项，位于 Provider 与上游模型名之间。默认值由选中 Provider 的 protocol 映射，但用户可为 chat route 选择任一 chat 格式。编辑时回显 route 已存值，切换 Provider 不覆盖用户已经显式选择的格式。

Provider 表单继续配置 Base URL，不增加 route 级 URL override。一个 Provider 的多种格式若不能共享同一 API 根地址，应建立多个 Provider；首期不增加额外 URL 层级。

## 12. 测试设计

### 12.1 单元与契约测试

- 每种 parser：合法最小请求、全部公共语义、每类禁用参数、嵌套参数路径、无状态规则。
- 每种 encoder：非流式、完整 SSE 生命周期、工具参数增量、推理、usage、finish、error。
- 鉴权：原生头、Bearer、缺失、无效、冲突、Gemini query Key 脱敏。
- route：迁移回填、action 默认/显式/省略更新、routing 读取 `apiFormat`、媒体兼容值。
- Abort 与提交边界：四种协议、五个 HTTP 路径均覆盖提交前 failover、提交后不切换、客户端断开。
- terminal cleanup：自然 finish/error/cancel、setup cancel、无响应 iterator 均验证 finally/usage/telemetry 恰好一次且取消后零写入。

### 12.2 16 组合集成矩阵

使用本地 fake upstream，不访问真实厂商。每个上游格式提供原生 JSON 和 SSE fixture，矩阵对每个 ingress x egress 组合断言：

- 实际请求 URL 只追加一次 endpoint。
- 认证头正确且无其他协议 Key 头。
- 纯文本请求在全部 16 组合中等价；图片、工具、JSON Schema 和推理控制按能力矩阵断言等价请求体或触网前 400。
- 返回 body/SSE 始终符合 ingress 协议。
- route 选择、Key 重试、breaker 和 usage 不受 ingress 格式影响。

### 12.3 回归

保留现有 gateway engine、routing、Chat、Hosted Search、媒体 adapter 测试。Hosted Search 仍可使用现有 format 判定，但普通聊天只能读 route `apiFormat`。

## 13. 发布与回滚

schema、迁移、route 写入、repository 读取、chat/media registry 与 UI 必须作为一个不可拆分 changeset 发布；不允许部署“数据库已有新值但运行时仍按 Provider protocol”或相反的中间状态。默认发布采用短维护窗口：暂停 route 写入，执行迁移并部署代码，再恢复写入。若环境要求滚动升级，应另做 expand/contract 方案，不在本任务中用静态默认值掩盖旧 writer。

数据库回滚前必须先确认没有 `openai-responses` 等无法由旧 Provider protocol 表达的新 route。安全回滚方式是先停止 route 写入，把 route 映射回兼容 Provider 或导出新值，再同时回滚应用与数据库；不得只回滚应用导致其重新按 Provider protocol 静默改协议。

## 14. 关键取舍

- 复用已安装 AI SDK，而不是手写四套上游 HTTP/SSE 客户端。
- 新建明确的 route API enum，而不是复用含媒体和 Provider 语义的 `ProviderProtocol`。
- 一个 CanonicalRequest/CanonicalEvent 事实源，而不是入口两两互转的 12 个转换器。
- 对不确定语义返回 400，而不是透传、忽略或猜测。
- 不增加 route 级 Base URL override；多根地址用多个 Provider 表达。
