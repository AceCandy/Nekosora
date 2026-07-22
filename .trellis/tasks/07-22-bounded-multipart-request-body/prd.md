# 限制 multipart 请求体内存占用

## Goal

在解析 multipart/form-data 前对请求流实施硬字节上限，防止超大上传在业务文件大小校验前被 `Request.formData()` 无界缓冲，同时为普通附件上传和 OpenAI 兼容语音转写保留明确的文件限制与 413 响应。

## Background

- `/api/upload` 先执行 `req.formData()`，之后才检查 `file.size > 10MB`；超大请求已经进入内存。
- `/v1/audio/transcriptions` 同样直接执行 `req.formData()`，且没有任何文件大小限制。
- 当前仓库只有这两个 route 使用 `formData()`，没有 multipart 边界测试。
- OpenAI 官方 Speech-to-Text 指南明确当前文件上传上限为 25MB：`https://developers.openai.com/api/docs/guides/speech-to-text/`。

## Requirements

- R1：新增共享流式读取 helper；Content-Length 已超限时不读取 body，无/伪造 Content-Length 时按实际 chunk 累计，超限立即 cancel。
- R2：普通上传文件上限保持 10MB，multipart 请求总体上限为 11MB（1MB 用于 boundary、filename、conversationId 等元数据）。
- R3：语音转写文件上限为 25MB，multipart 请求总体上限为 26MB。
- R4：请求总体或实际文件超限均返回 HTTP 413；不得调用 storage、DB、queue 或上游转写。
- R5：网关使用新增统一错误码 `request.payload_too_large`，OpenAI 错误形状与 Accept-Language 本地化保持一致。
- R6：两个入口的 413 都使用统一 `{ error: { code, message, type } }`；`useChatAttachments` 只按 HTTP 成败更新状态、不解析错误 body，因此无需前端改动。
- R7：合法 multipart 字段、文件名、mime、conversationId、language、prompt 的后续流程保持不变。

## Acceptance Criteria

- [x] AC1：单测证明 Content-Length 超限时 body 未被 pull，并抛出可识别的过大错误。
- [x] AC2：单测证明 chunked body 实际累计超限时流被 cancel，且不会继续读取。
- [x] AC3：单测证明限额内 multipart 可解析 file 与文本字段。
- [x] AC4：`/api/upload` 对总体/文件超限返回标准化 413，合法文件仍进入 storage；超限时不触达 storage/DB/queue。
- [x] AC5：`/v1/audio/transcriptions` 对总体/文件超限返回本地化 413，合法输入仍进入转写路由。
- [x] AC6：中英文字典覆盖新错误码，错误码元数据 status=413/type=`invalid_request_error`。
- [x] AC7：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过，无新增依赖或服务残留。

## Out of Scope

- 流式 multipart 字段解析或文件直传对象存储；本轮仍使用标准 `formData()`，但输入已严格有界。
- 修改前端附件大小提示或支持超过 10MB 的普通附件。
- 音频时长、编码格式或 token 级校验。
