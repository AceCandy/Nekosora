# 有界 multipart 请求体设计

## Data Flow

```text
Request.body ReadableStream
  -> Content-Length 快速拒绝（可信时仅作提前优化）
  -> reader.read() 实际累计（安全边界）
  -> 超限:reader.cancel() + RequestBodyTooLargeError
  -> 限额内:合并为 Uint8Array
  -> 新 Request(headers + bytes).formData()
  -> route 校验实际 File.size
  -> storage / transcription provider
```

安全边界以实际读取字节为准，不能只信 Content-Length。helper 返回标准 `FormData`，两个 route 不再直接调用原请求的 `formData()`。

## Limits

| Route | File limit | Multipart body limit |
| --- | ---: | ---: |
| `/api/upload` | 10MB | 11MB |
| `/v1/audio/transcriptions` | 25MB | 26MB |

额外 1MB 只容纳 multipart boundary 与文本元数据，不扩大实际文件限制。文件大小在解析后独立复验。

## Error Contract

- `RequestBodyTooLargeError(maxBytes)` 用于 route 区分 413 与 malformed multipart 400。
- 新错误码 `request.payload_too_large`：HTTP 413、`invalid_request_error`、中英文字典。
- 语音转写在总体/文件超限时记录同一错误码；内部上传也走 `apiError`。附件 hook 不读取失败 body，无需改动。

## Compatibility / Rollback

合法请求的 `FormData` 内容与原生解析结果一致。回滚 helper、两 route 接线和新错误码即可恢复；无依赖、数据库或配置迁移。
