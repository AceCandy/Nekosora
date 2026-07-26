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
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;
  readonly publicReadable: boolean;
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
- `signedUrl()` 始终生成有 TTL 的临时预签名 URL；`S3_PUBLIC_BASE_URL` 只供 `put().url` 返回明确公共产物，不能改变该语义。
- 未配置公共产物 URL 的 S3/R2/MinIO 保持 302；客户端的单段 Range 由对象存储处理。
- 配置公共产物 URL 时，私有文件 API 必须在属主校验后由应用代理 200/206，不能在 `Location` 暴露 `storagePath`。
- `publicReadable` 只表示 driver 配置了公共产物 URL 能力，不表示私有文件可以绕过鉴权读取。
- PreviewText 多取 1 字节判断截断，只解码前 512KB；固定合法范围收到 416 时按空文件处理，不依赖跨域暴露 `Content-Range`。

## 4. Validation & Error Matrix

| 条件 | HTTP | Storage 行为 |
|---|---:|---|
| 未登录 | 401 | 不读取 |
| 文件不存在或非属主 | 404 | 不读取 |
| 无 Range，local/fallback | 200 | `get(key)` |
| 合法单段 Range，local/fallback | 206 | `get(key, {start,end})` |
| 合法单段 Range，S3 无公共产物 URL | 302 | 不读取应用内 Buffer |
| 合法单段 Range，S3 有公共产物 URL | 206 | 应用代理有界读取，不调用 `signedUrl` |
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
- `s3.test.ts`：opts 转成 GetObject Range；无 opts 不带 Range；公共产物 URL 配置不能绕过 presigner，且 `put().url` 保持公共 URL。
- `route.test.ts`：206 headers/body/storage 参数、416 不读 storage、200 全量兼容、私有 S3 302、配置公共产物 URL 的 S3 代理 200/206。
- `assemble.test.ts`：`publicReadable=true` 时调用 `signedUrl()`，不读取完整对象做 base64 内联。
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

## Scenario: Safe Upload Names And Local Storage Keys

### 1. Scope / Trigger

Apply this contract when constructing a storage key from multipart `File.name`, or when changing `LocalDriver` path resolution. Multipart filenames are untrusted and may contain POSIX or Windows traversal segments.

### 2. Signatures

- `sanitizeUploadFilename(filename: string): string` is private to `/api/upload`.
- `LocalDriver.resolveKey(key: string): string` accepts legacy absolute paths or contained relative keys.
- A rejected relative key uses the stable error message `storage_key_outside_root`.

### 3. Contracts

- Normalize both `/` and `\\` as filename separators and keep only the final segment.
- Remove NUL, ASCII control characters, DEL, and surrounding whitespace. Empty, `.` and `..` normalize to `file`.
- Use the same safe filename in the storage key, `file_objects.filename`, and the upload response.
- Resolve relative storage keys against the configured root and reject a `relative(root, resolved)` result that is `..`, starts with `..${sep}`, or is absolute.
- Preserve absolute storage paths only for historical database compatibility; new uploads always produce relative keys.

### 4. Validation & Error Matrix

| Input / operation | Result |
| --- | --- |
| `../../../escape.txt` or `..\\..\\escape.txt` upload name | `escape.txt` in storage, DB, and response |
| Empty/control-only, `.` or `..` upload name | `file` |
| Contained relative key | Normal local operation |
| Outside-root relative key in put/get/delete | Throw `storage_key_outside_root` before filesystem access |
| Outside-root relative key in exists | Return `false` |
| Historical absolute key | Pass through unchanged |

### 5. Good / Base / Bad Cases

- Good: `userId/uuid-escape.txt` is persisted after a traversal-shaped filename is reduced to its basename.
- Base: `notes/report.txt` remains a valid nested relative key and existing absolute records remain readable.
- Bad: `join(root, key)` without containment validation lets enough `../` segments escape the storage root.

### 6. Tests Required

- Route tests must cover POSIX and Windows separators, embedded controls, fallback names, and equality across storage/DB/response.
- Local tests must prove put/get/delete reject outside-root keys without touching the sibling file, and `exists` returns false.
- Keep legal nested-key, legacy absolute-path, full-read, and Range-read regressions.
- Remove local temporary directories and sibling fixtures in `afterEach`.

### 7. Wrong vs Correct

```typescript
// Wrong: normalization alone does not prove containment.
return join(this.root, key);

// Correct: resolve first, then reject a path relative to the root that escapes it.
const path = resolve(this.root, key);
const relativePath = relative(this.root, path);
if (
  relativePath === ".." ||
  relativePath.startsWith(`..${sep}`) ||
  isAbsolute(relativePath)
) {
  throw new Error("storage_key_outside_root");
}
return path;
```

## Scenario: Upload Storage Compensation

### 1. Scope / Trigger

Apply this contract when `/api/upload` changes the sequence between `StorageDriver` writes and `file_objects` persistence. Object storage and PostgreSQL do not share a transaction, so failures after a successful put require best-effort compensation.

### 2. Signatures

- `StorageDriver.put(storagePath, data, mime)` persists the object first.
- `db.insert(fileObjects).values(...)` establishes the application-owned reference.
- `StorageDriver.delete(storagePath)` is the idempotent compensation action.

### 3. Contracts

- After put succeeds, wrap DB acquisition, schema access, and row insertion in one compensation boundary.
- If that boundary throws, attempt exactly one delete for the same generated storage key, then rethrow the original DB error.
- If delete also throws, log the cleanup error without replacing the original DB error.
- A failed put must not reach DB, delete, or queue code. A successful DB insert must not trigger delete.
- Compensation is best effort, not a distributed transaction. A connection failure after an upstream DB commit can make commit status ambiguous and remains an operational residual risk.

### 4. Validation & Error Matrix

| Condition | Storage compensation | Result |
| --- | --- | --- |
| Put fails | None | Original storage error |
| DB acquisition/schema/insert fails after put | Delete once | Original DB error |
| DB failure and delete failure | Delete attempted once; log cleanup error | Original DB error |
| DB insert succeeds | None | Existing queue/synchronous processing flow |

### 5. Good / Base / Bad Cases

- Good: a definite insert rejection deletes the just-written object and preserves the DB error for diagnosis.
- Base: a normal upload stores one object, inserts one row, and sends one processing job without deletion.
- Bad: letting an insert error escape immediately leaves an object with no `file_objects` owner or normal cleanup path.

### 6. Tests Required

- Assert DB acquisition and insertion failures delete the exact key once and preserve Error object identity.
- Assert cleanup failure is logged while the original DB Error still wins.
- Assert put failure does not call DB, delete, or queue.
- Keep the success-path assertion that delete is never called.

### 7. Wrong vs Correct

```typescript
// Wrong: an insert failure leaves the stored object orphaned.
await storage.put(storagePath, data, mime);
await db.insert(fileObjects).values(row);

// Correct: compensate only the pre-persistence failure window.
await storage.put(storagePath, data, mime);
try {
  const db = await getDb();
  const schema = getSchema();
  await db.insert(schema.fileObjects).values(row);
} catch (error) {
  try {
    await storage.delete(storagePath);
  } catch (cleanupError) {
    console.error("[upload] failed to clean up stored file:", cleanupError);
  }
  throw error;
}
```

## Scenario: Upload Queue Failure Fallback

### 1. Scope / Trigger

Apply this contract when changing `/api/upload` dispatch to the `file-process` queue. The pg-boss adapter can fail during initialization or send even though the only current adapter reports `available: true`.

### 2. Signatures

- `getQueue(): Promise<QueueAdapter>` may reject while initializing pg-boss.
- `queue.send("file-process", { fileId, storagePath, mime })` starts pg-boss, ensures the named queue, and may reject during initialization/creation/dispatch or when pg-boss returns no job id.
- `processFile(fileId, storagePath, mime): Promise<void>` is the existing no-queue fallback.

### 3. Contracts

- A successful queue send with a non-empty job id is the only path that skips synchronous fallback.
- `available: false`, queue acquisition failure, and send failure each start exactly one fire-and-forget `processFile` call.
- Log acquisition/send errors before fallback. Explicit `available: false` is not an error and must not emit a queue-failure log.
- Attach a rejection handler to fallback processing; a fallback failure is logged but does not turn the already-persisted upload response into an error.
- Normalize MIME once and reuse it for storage, DB, queue payload, and fallback; an empty type becomes `application/octet-stream`.
- A send that commits server-side but reports a client-side error can still race with fallback processing. Exactly-once dispatch and concurrent processing locks remain outside this contract.

### 4. Validation & Error Matrix

| Queue condition | Processing path | Upload response |
| --- | --- | --- |
| Send succeeds | Worker only | 200 processing |
| Adapter reports unavailable | Fire-and-forget fallback | 200 processing |
| `getQueue` or `send` throws | Log queue error, then fallback | 200 processing |
| Fallback rejects | Log processing error | Remains 200 processing |

### 5. Good / Base / Bad Cases

- Good: a transient pg-boss failure no longer leaves a persisted attachment indefinitely pending.
- Base: a healthy queue receives one job and the request process does no local file processing.
- Bad: awaiting `getQueue` and `send` outside a catch returns a failed upload after storage and DB persistence, while no retry path exists.

### 6. Tests Required

- Assert adapter acquisition and send failures both return 200, log the queue error, and call `processFile` once with the stored identifiers.
- Assert `available: false` falls back without a queue-error log.
- Assert healthy send does not invoke fallback.
- Assert fallback rejection is observed and logged without an unhandled rejection.
- Cover empty MIME equality across storage, DB, queue/fallback.

### 7. Wrong vs Correct

```typescript
// Wrong: queue exceptions escape after the upload has already been persisted.
const queue = await getQueue();
await queue.send("file-process", payload);

// Correct: all non-success dispatch paths converge on one fallback call.
let useSyncFallback = false;
try {
  const queue = await getQueue();
  if (queue.available) await queue.send("file-process", payload);
  else useSyncFallback = true;
} catch (queueError) {
  console.error("[upload] queue dispatch failed, using sync fallback:", queueError);
  useSyncFallback = true;
}
if (useSyncFallback) {
  processFile(fileId, storagePath, mime).catch(logSyncFailure);
}
```

## Scenario: Atomic File Processing Claim

### 1. Scope / Trigger

Apply this contract when changing `processFile`, the `file-process` worker, or upload fallback processing. Queue and fallback can deliver the same file concurrently.

### 2. Signatures

- `processFile(fileId: string, storagePath: string, mime: string): Promise<void>` claims a file before extraction.
- The claim updates `file_objects.processing_status` and `extract_status` and returns the claimed row id.

### 3. Contracts

- Claim with one atomic update constrained by `id = fileId` and `processing_status IN ('pending', 'error')`, setting `processing_status='extracting'` and `extract_status='running'`.
- If `returning()` yields no row, return before extract, chunk, embedding, or chunk persistence; do not overwrite another worker's status.
- A successful claim preserves existing unsupported, empty-text, embedding, done, and error transitions.
- This is a database-level claim, not an in-process mutex, so separate worker and web processes share the guard.
- It does not recover stale `extracting/embedding` rows or deduplicate historical chunks.

### 4. Validation & Error Matrix

| Claim result | Processing behavior |
| --- | --- |
| One `pending/error` row returned | Run the existing pipeline |
| Empty returning set | Immediate no-op |
| Row in another status / missing row | Immediate no-op |
| Claim query fails | Propagate to queue/fallback caller for retry handling |

### 5. Good / Base / Bad Cases

- Good: worker and fallback race; one atomically claims, the other exits before deleting or inserting chunks.
- Base: a pending upload claims once and reaches the existing status transitions.
- Bad: unconditional `extracting` update lets every concurrent caller delete and reinsert the same file's chunks.

### 6. Tests Required

- Assert the claim where clause combines file id equality with `pending/error` status membership.
- Assert an empty `returning()` result skips extract, chunk, embedding, delete, and insert calls.
- Assert a successful claim still handles unsupported files as `done/skipped`.
- Keep lint, typecheck, full tests, production build, and diff checks green.

### 7. Wrong vs Correct

```typescript
// Wrong: every caller enters the pipeline.
await update({ processingStatus: "extracting", extractStatus: "running" });
await extractText(storagePath, mime);

// Correct: only the caller that changed pending/error owns the pipeline.
const [claimed] = await db.update(s.fileObjects)
  .set({ processingStatus: "extracting", extractStatus: "running" })
  .where(and(
    eq(s.fileObjects.id, fileId),
    inArray(s.fileObjects.processingStatus, ["pending", "error"]),
  ))
  .returning({ id: s.fileObjects.id });
if (!claimed) return;
```

## Scenario: User-Owned RAG And Vision Files

### 1. Scope / Trigger

Apply this contract whenever client-supplied file IDs, knowledge-base IDs, RAG retrieval, or multimodal assembly can reach `file_objects`, `file_chunks`, or `StorageDriver`. IDs from WebChat, debug APIs, and MCP are untrusted even after authentication.

### 2. Signatures

- `retrieve(query, fileIds, { userId, ...opts })` requires the authenticated owner id.
- `getFileIdsByKnowledgeBases(kbIds, userId)` returns only that user's rag-ready files.
- `BuildContextInput` includes `userId`.
- `buildMultimodalUserMessage(text, imageFileIds, userId)` requires the owner id.

### 3. Contracts

- Every DB query that selects files for context, vector candidates, image storage reads, or KB expansion includes `file_objects.user_id = userId`.
- `retrieve(..., fileIds=[], { userId })` means all rag-ready files owned by that user, never all rows in the database.
- Context must derive the IDs sent to retrieve from the owner-filtered file rows, not reuse raw client IDs.
- WebChat's initial image classification and multimodal assembly both enforce owner filtering; this is intentional defense in depth.
- Unauthorized and missing IDs collapse to empty results without revealing whether another user's resource exists.

### 4. Validation & Error Matrix

| Input | Result |
| --- | --- |
| Owned explicit file IDs | Normal vision/full-context/RAG behavior |
| Mixed owned and foreign IDs | Only owned rows continue |
| Foreign KB IDs | No foreign file IDs returned |
| MCP search with empty file IDs | Current user's rag-ready corpus only |
| Only unauthorized IDs | Empty/skipped result, no storage read |

### 5. Good / Base / Bad Cases

- Good: a forged foreign image ID is absent from both classification and storage assembly queries.
- Base: the user's own KB files remain searchable from WebChat, debug search, and MCP.
- Bad: filtering only by primary key lets any authenticated caller read another user's image bytes or chunks when an ID is guessed or leaked.

### 6. Tests Required

- Retrieve tests cover explicit and empty file ID lists and assert owner + rag-ready SQL conditions.
- Context tests assert only IDs from owner-filtered rows reach retrieve with the same userId.
- Multimodal tests assert owner filtering and zero storage calls for an empty owned result.
- KB service tests assert kbIds + owner + rag-ready conditions.
- Search all call sites and run typecheck so no legacy signature can omit userId.

### 7. Wrong vs Correct

```typescript
// Wrong:authentication does not make client-supplied IDs owned.
const files = await db.select().from(s.fileObjects)
  .where(inArray(s.fileObjects.id, fileIds));

// Correct:authorization is part of the resource query.
const files = await db.select().from(s.fileObjects)
  .where(and(
    inArray(s.fileObjects.id, fileIds),
    eq(s.fileObjects.userId, userId),
  ));
```
