# File Storage And Range Reading

## 1. Scope / Trigger

修改 `StorageDriver`、`/api/files/[fileId]`、文本/媒体预览或对象存储下载流程时，必须保持本契约。目标是让私有文件继续经过属主鉴权，同时支持端到端有界读取，避免客户端截断前先把完整对象加载进内存。

## 2. Signatures

```typescript
interface GetOpts {
  start: number; // 包含端点
  end: number;   // 包含端点
}

interface StorageDriver {
  get(key: string, opts?: GetOpts): Promise<Buffer>;
}
```

- HTTP 入口：`GET /api/files/[fileId]`
- 请求头：单段 `Range: bytes=<start>-<end>` / `bytes=<start>-` / `bytes=-<suffix>`
- 前端文本预览固定请求：`Range: bytes=0-524288`，即 512KB + 1 字节。

## 3. Contracts

- `GetOpts` 是非负安全整数闭区间，`end >= start`；缺省 opts 表示完整对象，现有 RAG/多模态调用不变。
- LocalDriver 使用 positional read，只分配目标区间长度；S3Driver 翻译为 GetObject `Range: bytes=start-end`。
- 文件 API 必须先鉴权和校验属主，再解析 Range；非法或不可满足范围不得读取 storage。
- local/fallback 的合法范围返回 206、`Content-Range`、`Accept-Ranges`、实际 `Content-Length`。
- S3/R2/MinIO 有预签名 URL 时保持 302；客户端的单段 Range 由对象存储处理。
- PreviewText 多取 1 字节判断截断，只解码前 512KB；固定合法范围收到 416 时按空文件处理，不依赖跨域暴露 `Content-Range`。

## 4. Validation & Error Matrix

| 条件 | HTTP | Storage 行为 |
|---|---:|---|
| 未登录 | 401 | 不读取 |
| 文件不存在或非属主 | 404 | 不读取 |
| 无 Range，local/fallback | 200 | `get(key)` |
| 合法单段 Range，local/fallback | 206 | `get(key, {start,end})` |
| 合法单段 Range，S3 有签名 URL | 302 | 不读取应用内 Buffer |
| 非法、多段、反向或越界 Range | 416 | 不读取；`Content-Range: bytes */size` |
| storage 读取失败 | 500 | 返回既有内部错误 |

只支持单段 Range；multipart/byteranges 不在当前契约内。明确 end 或 suffix 超过文件大小时夹到 `size - 1`；空文件上的任何 Range 都不可满足。

## 5. Good / Base / Bad Cases

- Good：10MB 文本预览只从 local/S3 读取 512KB + 1 字节，前端只解码 512KB并显示截断提示。
- Base：RAG 与多模态继续调用 `get(key)`，行为和返回 Buffer 不变。
- Bad：前端先 `arrayBuffer()` 完整响应，再按 `text.length` 截断；这既按字符而非字节限制，也没有降低网络和服务端内存开销。

## 6. Tests Required

- `http-range.test.ts`：明确区间、开放结尾、suffix、边界夹取、非法/多段/越界。
- `local.test.ts`：有界读取返回指定字节；无 opts 保持全量。
- `s3.test.ts`：opts 转成 GetObject Range；无 opts 不带 Range。
- `route.test.ts`：206 headers/body/storage 参数、416 不读 storage、200 全量兼容、S3 302。
- 全量运行 lint、typecheck、vitest；本地测试产生的临时目录必须在 `afterEach` 删除。

## 7. Wrong vs Correct

```typescript
// Wrong:完整下载后按字符数截断，无法控制传输字节和内存。
const text = new TextDecoder().decode(await response.arrayBuffer());
setContent(text.slice(0, MAX_TEXT_BYTES));

// Correct:多取 1 字节判断截断，只解码预算内字节。
const response = await fetch(url, {
  headers: { Range: `bytes=0-${MAX_TEXT_BYTES}` },
});
const buffer = await response.arrayBuffer();
const truncated = buffer.byteLength > MAX_TEXT_BYTES;
const preview = truncated ? buffer.slice(0, MAX_TEXT_BYTES) : buffer;
setContent(new TextDecoder().decode(preview));
```

## Scenario: Bounded Multipart Uploads

### 1. Scope / Trigger

Apply this contract to any route that calls `Request.formData()` for file uploads. Standard form-data parsing buffers the body, so the request stream must be bounded first.

### 2. Signatures

- `parseBoundedMultipartFormData(request: Request, maxBytes: number): Promise<FormData>`
- `RequestBodyTooLargeError(maxBytes)`
- `/api/upload`: file 10MB, total multipart body 11MB.
- `/v1/audio/transcriptions`: file 25MB, total multipart body 26MB. The 25MB file limit follows the official OpenAI Speech-to-Text guide.

### 3. Contracts

- Reject an already excessive numeric Content-Length without obtaining a body reader.
- Content-Length is only a fast path; always count actual stream chunks when reading.
- When actual bytes exceed the body limit, cancel the reader and throw `RequestBodyTooLargeError`.
- After materializing the bounded bytes, remove the original `Content-Length` and `Transfer-Encoding` before constructing the parsing Request; client framing metadata may not match actual bytes.
- After bounded parsing, independently check `File.size`; the extra 1MB is only multipart metadata allowance.
- Oversize paths return before storage, DB, queue, or transcription provider calls.

### 4. Validation & Error Matrix

| Condition | HTTP / result | Downstream |
| --- | --- | --- |
| Declared or actual body exceeds route body limit | 413 `request.payload_too_large` | None |
| Parsed file exceeds route file limit | 413 `request.payload_too_large` | None |
| Malformed multipart within limit | Existing invalid-body 400 | None |
| Valid attachment | 200 processing response | Storage, DB, queue |
| Valid transcription | 200 text response | Transcription route |

### 5. Good / Base / Bad Cases

- Good: a chunked 100MB request without Content-Length is canceled after crossing 11MB/26MB.
- Base: a small multipart request produces the same File and text fields as native `formData()`.
- Bad: call `req.formData()` first and inspect `file.size` later; the limit no longer protects memory.

### 6. Tests Required

- Assert Content-Length fast rejection does not call `getReader()`.
- Assert actual chunk overflow invokes stream cancel.
- Assert valid multipart preserves File name/content and text fields.
- Assert a falsely small Content-Length cannot truncate or corrupt an otherwise bounded multipart body.
- Route tests must prove oversize paths do not reach storage/DB/queue/provider and valid paths still do.

### 7. Wrong vs Correct

```typescript
// Wrong: body is already buffered before the limit check.
const form = await request.formData();
if ((form.get("file") as File).size > maxFileBytes) return tooLarge();

// Correct: bound total bytes first, then enforce the stricter file limit.
const form = await parseBoundedMultipartFormData(request, maxBodyBytes);
const file = form.get("file");
if (file instanceof File && file.size > maxFileBytes) return tooLarge();
```
