# 实现文本预览端到端有界读取

## Goal

让文本预览真正只传输并读取前 512KB 内容，同时为私有文件下载端点提供正确的单段 HTTP Range 响应，避免当前客户端和 local storage 路径先加载完整 10MB 文件再截断。

## Background

- `PreviewText.tsx` 当前先 `res.arrayBuffer()` 读取完整响应，再按 `text.length` 截断；限制的是解码后字符数，不是传输字节数。
- `/api/files/[fileId]` 忽略 Range，并在 local 路径调用 `storage.get()` 读取完整 Buffer。
- 上传上限为 10MB，因此单次浪费有上界，但最多是目标预览字节数的约 20 倍。
- S3 类存储优先重定向到预签名 URL；标准单段 Range 请求可由对象存储继续处理。

## Requirements

- R1：`PreviewText` 请求前 512KB 加 1 字节，以额外字节可靠判断是否截断；渲染内容最多解码 512KB。
- R2：文件 GET 端点支持单段 `Range: bytes=...`，包括明确起止、开放结尾和 suffix 三种形式。
- R3：合法 Range 返回 206、`Content-Range`、`Accept-Ranges: bytes` 和实际 `Content-Length`；非法/越界返回 416 与 `Content-Range: bytes */<size>`。
- R4：无 Range 请求保持 200 全量响应；属主鉴权、404、500 和 S3 重定向行为保持不变。
- R5：`StorageDriver.get` 增加可选闭区间读取参数；LocalDriver 定位读取，S3Driver 使用 GetObject `Range`，现有全量调用无需修改。
- R6：补齐 `PreviewText` effect 的 `t` 依赖，消除最后一条现有 lint warning。
- R7：不支持 multipart 多段 Range，不修改上传大小、UI 样式或文件处理/RAG逻辑。

## Acceptance Criteria

- [x] AC1：自动化测试覆盖单段 Range 三种合法格式及非法/越界 416。
- [x] AC2：API 测试证明 Range 请求向 storage 传入正确闭区间并返回正确 206 headers/body；无 Range 保持 200。
- [x] AC3：LocalDriver 测试证明有界读取返回指定字节，不读取到区间外内容；全量 get 行为保持。
- [x] AC4：S3Driver 构造 GetObject 时传入标准 `Range: bytes=start-end`，全量读取不传 Range。
- [x] AC5：PreviewText 最多解码 512KB，并用第 512KB+1 字节判定截断。
- [x] AC6：lint 零 warning/error，typecheck、相关测试、全量测试和 `git diff --check` 通过。
- [x] AC7：没有临时文件或调试服务残留。

## Out of Scope

- multipart/byteranges 多段响应。
- 断点续传上传、缓存策略或公开分享文件。
- PDF 懒加载、媒体播放器改造或 RAG 提取范围读取。
