# Verification Evidence

## Behavioral Checks

- Probe fetch、模型构造、非流式和流式错误均使用当前 API key 与自定义 header 值做精确脱敏。
- `streamChat()` / `generateChat()` 继续用原始错误做 status、鉴权、重试、故障转移和熔断判断，只向事件、返回值、console 与日志传安全消息。
- 图像、TTS、STT 适配器在持有明文 key 的边界抛出不携带原始 cause/stack 的安全 `Error`。
- 四个媒体 route 的 HTTP、console、错误日志与 `image_jobs.error` 只接收安全消息。
- `logUsage()` 对 `ops_error_logs.errorMessage` 做通用兜底；run/tool JSONB 同时清洗敏感字段和嵌入字符串凭据。

## Independent Review

- 三路只读复核分别检查完整 sink、行为回归和验收覆盖，均未发现阻塞项。
- 复核确认每次 stream key/route 尝试和全部 probe 路径都传入实际 key 与自定义 header 值。
- 复核确认 route/API schema、错误码/status、重试与故障转移语义未改变。

## Automated Gates

- 定向测试：10 个文件，105 项测试通过。
- 全量测试：63 个文件，601 项测试通过。
- `pnpm lint`：通过，无警告或错误。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `git diff --check`：通过。

## Not Verified

- 未连接真实 provider 触发含凭据的线上错误；请求构造、错误传播与 sink 行为由单元测试和静态数据流复核验证。
- 未扫描或清理历史数据库与日志系统中已经持久化的错误文本，本轮只保护新增写入。
- 未作为精确 secret 传入、且不符合已识别凭据形态的任意 opaque 值无法可靠推断；持有 key/header 的调用边界已按契约传入实际值。
