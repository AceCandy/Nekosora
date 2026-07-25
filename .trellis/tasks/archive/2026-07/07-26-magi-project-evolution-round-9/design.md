# Technical Design

## Boundary

修改 `S3Driver.signedUrl()` 与 `GET /api/files/[fileId]` 的分流条件，不改变 StorageDriver 公共签名、上传 key、数据库 schema 或生成图片调用方。

## Access Paths

```text
private file request
  -> session + owner check
  -> local OR publicReadable S3: application get() -> 200/206
  -> private S3: signedUrl(ttl=3600) -> 302

generated public image
  -> storage.put()
  -> publicBaseUrl/key remains the returned public URL

vision attachment with configured public capability
  -> storage.signedUrl()
  -> temporary presigned S3 URL, never bare CDN URL
```

## Contracts

- `signedUrl` means temporary capability URL regardless of `publicBaseUrl`.
- `put().url` remains the explicit public-output mechanism.
- A public CDN configuration must not cause the private file route to disclose `storagePath`; that route proxies bytes instead.
- Range parsing stays before storage access. The proxy path passes the validated closed interval to `storage.get`.

## Trade-Offs

- Proxying private files when `publicReadable=true` costs application bandwidth but avoids exposing a key that the configured CDN may serve permanently.
- Adding visibility to every storage write would model intent more explicitly, but it expands schema/API/migration scope without being required for this concrete leak.

## Compatibility And Rollback

- No stored data changes and no environment changes are required.
- Removing the two behavior changes restores the prior routing immediately.
- Existing generated image URLs remain stable because `put().url` is untouched.
