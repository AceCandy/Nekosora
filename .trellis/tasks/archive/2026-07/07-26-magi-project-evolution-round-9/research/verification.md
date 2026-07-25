# Verification Evidence

## Behavioral Checks

- 配置 `publicBaseUrl` 的 `S3Driver.signedUrl()` 仍调用 AWS presigner，并把 TTL 夹在 1 到 604800 秒。
- `S3Driver.put()` 继续为明确公共产物返回 `${publicBaseUrl}/${key}`。
- `publicReadable=true` 的私有文件请求由应用代理返回 200/206，不调用 `signedUrl()`，响应不含 `Location`。
- `publicReadable=false` 的 S3 类存储继续通过 1 小时临时签名 URL 返回 302。
- 未登录返回 401、非属主返回 404，且两者都不会初始化或读取 storage。
- 多模态组装在 `publicReadable=true` 时使用 1 小时临时签名 URL，不读取完整对象做 base64 内联。

## Independent Review

- 独立复核确认 session 与属主校验位于任何 storage 读取或重定向之前。
- 独立复核确认私有文件 API 不再返回裸 CDN URL 或泄露 `storagePath`。
- 复核发现并补齐设计文档接口签名、未登录/非属主路由测试和 TTL 边界测试。
- 无阻断项。

## Automated Gates

- 定向测试：3 个文件，15 项测试通过。
- 全量测试：61 个文件，579 项测试通过。
- `pnpm lint`：通过，无警告或错误。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：通过。

## Not Verified

- 未连接真实 S3/R2/MinIO 或 CDN；presigner 调用、请求参数和路由分流由单元测试验证。
- 运维若把整个 bucket 或所有私有 key 暴露到公共 CDN，应用无法撤销已经泄露的对象地址；环境变量与存储规范已明确禁止该配置。
