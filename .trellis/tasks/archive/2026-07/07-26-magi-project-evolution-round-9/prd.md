# MAGI 项目进化第 9 轮

## Goal

阻止 `S3_PUBLIC_BASE_URL` 把属主私有文件变成永久裸公网链接，同时保留生成图片等明确公共产物的 CDN URL 行为。

## Background

- `GET /api/files/[fileId]` 在数据库中校验属主后，对非 local driver 调用 `signedUrl()` 并 302。
- `S3Driver.signedUrl()` 在配置 `publicBaseUrl` 时直接返回 `${publicBaseUrl}/${key}`，没有签名或 TTL。
- 同一个 S3 driver 同时承载私有上传与生成图片；`put().url` 是生成图片公共返回值，不能整体删除公共 URL 能力。
- 数据库存储规范明确 `/api/files/[fileId]` 是属主私有入口，公共分享不包含文件。

## Requirements

- `S3Driver.signedUrl()` 必须始终使用 S3 presigner，并继续把 TTL 夹在 1 到 604800 秒；配置 `publicBaseUrl` 不能绕过签名。
- 当 storage 配置公共直链能力时，私有文件端点不得把对象 key 放入 302 `Location`；应在属主校验后通过应用读取并返回 200/206。
- 私有 S3/R2/MinIO 未配置公共直链时继续使用 1 小时预签名 URL 302，避免不必要的应用带宽。
- `S3Driver.put()` 的公共 URL 返回和 `publicReadable` 保持不变，确保生成图片及现有视觉调用不回归。
- local 完整读取、Range 206、非法 Range 416、未登录 401、非属主 404 行为保持不变。
- 不新增环境变量、数据库迁移、文件可见性字段或跨 driver 抽象。

## Acceptance Criteria

- [x] 配置 `publicBaseUrl` 的 S3 driver 调用 `signedUrl()` 时仍调用 presigner，返回 URL 不等于裸 `${publicBaseUrl}/${key}`。
- [x] `publicReadable=true` 的非 local storage 通过文件端点读取时不调用 `signedUrl()`，不返回 302，并支持 200/206 代理响应。
- [x] `publicReadable=false` 的 S3 类 storage 继续返回 1 小时预签名 302。
- [x] `put()` 对公共产物返回 CDN URL 的既有契约不变。
- [x] 未登录、非属主、非法 Range 和 local 路径不回归。
- [x] 定向测试、lint、typecheck、全量测试和生产构建通过。

## Out Of Scope

- 重构公共与私有对象为独立 bucket、CDN distribution 或数据库 visibility 字段。
- 迁移既有对象 key、修改生成图片 API 或改变上传响应格式。
- 修复本轮审计发现的聊天软删除竞态、错误脱敏、队列投递、MCP 子 key 或分享数量上限。

## Risks And Deferred Items

- 若运维把整个 bucket/CDN 配成任意 key 公开，应用无法对已泄露 key 恢复访问控制；本轮确保私有文件 API 不再泄露公共前缀或对象 key，并在规范中要求公共 CDN 不暴露私有对象路径。
- 公共 CDN 配置下私有下载改走应用代理，会增加应用带宽；这是保证鉴权边界的明确取舍。
