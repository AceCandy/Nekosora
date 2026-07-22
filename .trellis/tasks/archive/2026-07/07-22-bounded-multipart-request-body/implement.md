# 实施计划

1. 为共享 multipart helper 写红灯测试：Content-Length 快拒、chunked 超限 cancel、合法 multipart 解析。
2. 实现 `RequestBodyTooLargeError` 与有界读取/解析，不依赖第三方包。
3. 为上传 route 写总体/文件超限与合法存储测试，再接入 11MB 总体上限和标准 413。
4. 新增 `request.payload_too_large` 元数据和中英文字典，扩展 i18n 覆盖测试。
5. 为语音转写 route 写总体/文件超限与合法调用测试，再接入 26MB 总体/25MB 文件限制。
6. 运行目标测试、lint、typecheck；复核超限路径不会触达 storage/DB/queue/provider。
7. 运行全量测试、生产构建与 `git diff --check`，更新文件存储/错误处理规范。
