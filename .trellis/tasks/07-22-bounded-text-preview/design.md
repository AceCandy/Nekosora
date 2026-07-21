# 文本预览有界读取设计

## Data Flow

```text
PreviewText: Range bytes=0-524288
        |
        v
GET /api/files/[fileId]
  auth -> metadata(size) -> parse single range
        |
        +-- local: storage.get(key, { start, end }) -> 206
        |
        +-- S3-like: signed URL redirect; browser forwards Range
```

前端多请求 1 字节：响应长度大于 512KB 即表示截断；随后只解码前 512KB。这样不依赖跨域响应是否暴露 `Content-Range`。

## Storage Contract

`StorageDriver.get(key, opts?)` 的 `opts` 是闭区间 `{ start, end }`，两端均为非负安全整数且 `end >= start`。调用方负责依据已知对象大小夹取范围。

- LocalDriver 使用 file handle 的 positional read，只分配区间长度。
- S3Driver 把闭区间翻译为 GetObject `Range: bytes=<start>-<end>`。
- `opts` 缺省时沿用全量 Buffer 行为，现有 RAG、多模态调用不变。

## HTTP Range Contract

- 仅接受一个 `bytes` range；含逗号的多段请求返回 416。
- `bytes=start-end`：end 夹到 `size - 1`。
- `bytes=start-`：读取 start 到文件末尾。
- `bytes=-suffix`：读取最后 suffix 字节，suffix 超过文件大小时返回全文件。
- 空范围、非数字、start 越界、end < start、空文件 Range 均返回 416。

## Compatibility And Rollback

- GET 无 Range、鉴权与错误响应保持不变。
- StorageDriver 参数可选，不要求修改现有调用方。
- 回滚涉及 helper、API、两个 driver、PreviewText 与测试，无数据迁移。
