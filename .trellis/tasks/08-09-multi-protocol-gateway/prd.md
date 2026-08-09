# 多协议双向网关

## Goal

将 Nekusora 建设为真正的双向协议转换网关。调用方可以使用 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 或 Google Gemini GenerateContent 中的任一种协议访问同一套模型；网关根据实际选中的上游路由转换请求，并把上游结果转换回调用方使用的协议。

目标数据流固定为：

```text
客户端协议 -> 统一内部请求 -> 路由对应的上游协议
客户端协议 <- 统一内部事件 <- 上游协议响应
```

入口协议与上游协议完全解耦。例如，调用方使用 `/v1/responses` 请求 Claude 模型时，可以由一条 `anthropic-messages` 路由向 `/messages` 发出请求，再以 Responses 格式返回结果。

## Background

- 当前唯一聊天网关入口是 `POST /v1/chat/completions`，路由注册位于 `packages/contracts/src/routes.ts:1-20`。
- 当前 `IRRequest` 与 `StreamEvent` 位于 `packages/core/src/lib/providers/types.ts:63-124`，但以 Chat Completions 语义为主，无法完整表达四种协议的工具增量和事件生命周期。
- 普通聊天目前由 `packages/core/src/lib/providers/registry.ts:43-115` 按 Provider protocol 固定选择 SDK；OpenAI Responses 只在 Hosted Search 路径使用。
- `routes` 当前没有上游 API 格式字段，运行时在 `packages/core/src/lib/routing.ts:142-148` 直接继承 Provider protocol。
- 同一 Provider 可能连接一个同时暴露多种 wire protocol 的上游，因此上游格式必须属于具体 route，而不是 Provider。
- Base URL 是 API 根地址。以 OpenAI 为例，应配置 `http://192.168.1.205:3500/v1`；若配置成 `.../v1/responses`，SDK 会继续追加 `/responses` 或 `/chat/completions`，形成错误路径。

## Requirements

### R1. 客户端入口

网关必须注册四种协议对应的五个 POST 路径，并在独立 Gateway 与 Web 代理路径中保持一致：

- `/v1/chat/completions`
- `/v1/responses`
- `/v1/messages`
- `/v1beta/models/{model}:generateContent`
- `/v1beta/models/{model}:streamGenerateContent`

### R2. 路由级上游格式

- 每条 route 必须保存明确的 `apiFormat`；同一 Provider 下的不同 route 可以选择不同格式。
- 首期聊天格式为 `openai-chat`、`openai-responses`、`anthropic-messages`、`gemini-generate-content`。
- Provider 的 `protocol` 只保留为 Provider 默认值、模型列表探测及既有连接配置，不再决定普通聊天实际出站格式。
- 存量 route 必须按其关联 Provider 的现有 protocol 回填，保证迁移前后行为一致。

### R3. 双向转换

- 每种入口都必须先解析成同一个协议无关请求，再进入现有路由、Key 轮换、熔断、遥测和故障转移链路。
- 出站 adapter 必须根据实际 route 的 `apiFormat` 选择 endpoint、鉴权头和请求体。
- 上游响应必须先转换成统一事件，再由入口协议 encoder 生成非流式 JSON 或原生流式事件。
- 四种客户端协议均能路由到四种上游格式，覆盖 4 x 4 共 16 种组合；入口格式不得影响 route 选择。

### R4. 首期公共语义

首期支持：

- system、developer、user、assistant 消息
- 文本和图片输入、文本输出
- 流式与非流式调用
- 自定义函数工具、工具选择、工具调用和工具结果
- JSON Schema 结构化输出
- 由 `model_catalog` 定义的推理开关与强度
- finish reason、usage 和安全错误

所有模型能力、推理格式和档位继续以 `model_catalog` 为唯一事实来源。不得根据模型名、Provider 名或 URL 猜测能力，也不得向上游伪造不支持的控制参数。

### R5. 明确拒绝不支持的参数

首期不支持以下能力：

- 音频输入
- 文件上传、文件引用
- Provider 专有内置工具
- logprobs
- 多候选结果
- 调用方提交的 Provider 专有缓存字段

请求解析必须使用显式 allowlist。任何无法可靠转换的顶层或嵌套参数，都必须在访问上游前返回 HTTP `400`，错误文本使用 `Unsupported parameter: '<参数路径>'.`，并在错误结构中单独提供参数名；不得静默忽略或伪造成功。

该错误必须登记为项目统一点分错误码 `request.unsupported_parameter`，HTTP 状态继续由 `ERROR_META` 决定；四种协议只负责把同一个内部错误编码成各自原生 envelope。

多候选控制值为 1 时可按单候选处理；大于 1 时按不支持参数拒绝。数值推理预算只有在能由目录映射为明确档位时才能接受，否则返回相同的 `400`。

### R6. 无状态 Responses

- 首期只支持调用方每次提交完整上下文的无状态调用。
- Responses 的 `store` 只允许省略或为 `false`。
- `previous_response_id`、`conversation`、`background`、`store: true` 以及依赖上游持久状态的读取、取消、删除操作必须在访问上游前返回明确的 HTTP `400`。

### R7. 鉴权与密钥安全

- OpenAI 入口接受 `Authorization: Bearer`。
- Anthropic 入口接受 `x-api-key`，并同时接受 Bearer。
- Gemini 入口接受 `x-goog-api-key`，并同时接受 Bearer。
- 同时提交两种不同 Key 时不得任选其一，必须按无效鉴权拒绝。
- Gemini `?key=` 必须返回 HTTP `400`；应用日志、遥测和错误中不得记录查询参数中的 Key。
- 出站 adapter 必须使用目标协议原生鉴权头，且 Provider 自定义 headers 不得覆盖本次选中的认证凭据。

### R8. Base URL、探测与取消

- Base URL 只保存 API 根地址和必要版本前缀；具体 endpoint 由 adapter 追加。
- Provider 模型列表仍按 Provider protocol 从 Base URL 请求 `/models`；route 模型可用性探测必须按 route `apiFormat` 走真实生成 endpoint。
- 客户端断开必须经 `Request.signal` 取消当前上游调用；Abort 不重试、不故障转移、不记录 Provider 普通失败。
- 流一旦输出文本、推理或工具调用事件，不得再切换 Key 或 route，避免拼接不同上游的响应。

## Out of Scope

- Responses 持久对象的查询、取消、删除和跨请求续接。
- 音频、文件、Provider 内置工具、logprobs、多候选及专有缓存控制的协议转换。
- 图像生成、语音识别、语音合成等非聊天执行链重构；只为存量 route 做兼容迁移。
- 与本任务无关的模型目录、Provider、WebChat 或管理界面重构。
- 为每个协议重写重试、熔断、遥测或故障转移引擎。

## Acceptance Criteria

- [ ] AC1：五个客户端 POST 路径均可注册、鉴权和到达共享执行链；Gemini 动态 model 参数解析正确。
- [ ] AC2：Anthropic `x-api-key`、Gemini `x-goog-api-key` 和统一 Bearer 均有成功、缺失、无效及冲突测试；Gemini `?key=` 被拒绝且测试证明 Key 未进入应用日志。
- [ ] AC3：数据库迁移、Drizzle journal/snapshot、route 创建/更新/快速挂载和路由解析均支持 `apiFormat`；存量聊天及媒体 route 回填后保持原行为。
- [ ] AC4：四种协议各自具有请求校验、非流式响应、流式响应和原生错误 envelope 契约测试；Gemini 的普通与流式两个 HTTP 路径分别覆盖。
- [ ] AC5：自动化矩阵覆盖四种客户端协议到四种上游格式的 16 种组合，并断言实际 URL、鉴权头、请求体和返回协议。
- [ ] AC6：文本、图片、自定义函数工具与结果、JSON Schema、推理控制、finish reason、usage 按设计能力矩阵分别具有成功映射或访问上游前 400 的测试。
- [ ] AC7：音频、文件、专有内置工具、logprobs、多候选、专有缓存字段及无法映射的嵌套字段返回 HTTP `400`，包含准确参数路径，且没有上游请求。
- [ ] AC8：Responses 状态参数均按 R6 拒绝；无状态 Responses 可参与 Key 轮换、route 故障转移和熔断。
- [ ] AC9：route 不兼容某个请求语义时，在未访问上游的前提下尝试后续兼容 route；全部 route 均不兼容时返回带参数名的 HTTP `400`，且不更新熔断。
- [ ] AC10：现有 `/v1/chat/completions` 文本、工具、流式 `[DONE]`、usage、错误和状态码保持兼容。
- [ ] AC11：客户端断开可取消四种协议、五个 HTTP 路径的上游调用；已经提交响应后不发生 Key/route 切换。
- [ ] AC12：Base URL 为 `.../v1` 时可正确产生 `.../v1/chat/completions`、`.../v1/responses` 或 `.../v1/messages`，不会产生重复 endpoint；Gemini 根地址同理。
