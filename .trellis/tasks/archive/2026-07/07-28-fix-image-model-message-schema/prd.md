# 修复图片消息 ModelMessage 校验错误

## Goal

修复聊天发送图片时 AI SDK 抛出 `The messages do not match the ModelMessage[] schema.` 的错误，使支持视觉的模型能够正常接收文本与图片，同时保持现有网关 OpenAI 兼容消息格式不变。

## Background

- 项目内部 `IRMessage` 使用 OpenAI Chat Completions 格式，图片 part 为 `{ type: "image_url", image_url: { url } }`（`src/lib/providers/types.ts:61`、`src/lib/multimodal/assemble.ts:74`）。
- `ai@7.0.31` 的 `ModelMessage` 运行时 schema 不接受 `image_url`，只接受 AI SDK 图片或文件 part；`streamText` 和 `generateText` 当前通过 `as never` 将 IR 消息直接传入 SDK（`src/lib/stream.ts:500`、`src/lib/stream.ts:648`）。
- 纯文本消息符合两侧 schema，因此错误只在包含图片 part 时出现。

## Requirements

- 在 AI SDK 调用边界把用户消息中的 OpenAI `image_url` part 转换为 AI SDK 接受的图片 part。
- 同一转换必须用于 `streamText` 与 `generateText`，避免流式聊天和后台非流式生成行为分叉。
- 文本内容、文本 part、消息角色、工具消息及现有 provider options 必须保持原行为。
- 远程预签名 URL 与 `data:` URL 都必须可转换；转换后的消息必须通过 AI SDK `ModelMessage[]` 运行时 schema。
- 不改变 `IRMessage`、上传接口、数据库结构或对外 OpenAI 兼容网关协议。
- 为转换函数和两个调用边界补充聚焦回归测试，防止再次通过类型断言绕过格式差异。

## Acceptance Criteria

- [x] 含远程图片 URL 的用户消息不再触发 `ModelMessage[]` schema 错误，并保留对应图片内容。
- [x] 含 base64 `data:` URL 的用户消息不再触发该错误，并保留 MIME 类型与图片数据。
- [x] 纯文本消息及文本 part 转换前后语义不变。
- [x] `streamText` 和 `generateText` 均接收转换后的 AI SDK 消息，而不是原始 `image_url` part。
- [x] 新增的定向测试、现有相关测试与 TypeScript 类型检查通过。

## Out Of Scope

- 不调整历史多模态消息的数据库序列化或恢复逻辑。
- 不新增图片格式、压缩策略或视觉能力判断。
- 不升级或降级 AI SDK 依赖。

## Risks And Deferred Items

- 历史消息若曾以 JSON 字符串或对象形式保存，仍可能无法恢复为结构化图片 part；该问题与本次发送失败根因不同，留待单独任务处理。
- 转换必须严格限制在 AI SDK 边界；若提前改写共享 IR，会破坏对外 OpenAI 兼容请求。
