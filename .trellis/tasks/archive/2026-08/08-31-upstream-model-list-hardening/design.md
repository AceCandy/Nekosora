# 上游模型列表拉取加固设计

## Trust Boundary

保护放在 `packages/core/src/lib/providers/probe.ts` 的共享 `fetchUpstreamModels` 内，admin/panel 调用方不增加重复分支。

固定边界：

| 边界 | 行为 |
| --- | --- |
| 响应体 | 实际读取最多 4 MiB |
| 有效模型 | 最多 2000 个，超限整体失败 |
| 重定向 | 最多 5 次，仅允许初始 origin 内 |
| 总预算 | 保持现有 15 秒 probe/read 上限 |

## Request And Redirect Flow

1. 沿用 `buildModelsRequest` 生成协议 URL、认证头和 Gemini query key。
2. 使用 `redirect: "manual"` 逐跳请求，借助标准 `URL` 解析 `Location`。
3. 只接受同一 origin；在发起下一跳前拒绝跨 origin、缺失/无效 `Location`、循环和第 6 次重定向。
4. 同 origin 才复用原请求初始化，因此认证头和 query key 不会传播到其他 origin。
5. 所有跳转和响应读取共用现有 timeout scope，不重置 15 秒预算。

## Bounded Body And Parsing

- `Content-Length` 只有在它是单个十进制非负整数时才作为快速拒绝依据；缺失、重复、负数或非整数值忽略，统一依赖实际流式字节计数。
- 合法 `Content-Length` 已超过 4 MiB 时直接失败。
- 通过 `Response.body.getReader()` 累加实际 `Uint8Array.byteLength`；超过上限立即取消读取并失败。
- 在完整受限字节读取后用 `TextDecoder` 和 `JSON.parse`，不再调用无上限的 `Response.json()`。
- 沿用现有三种协议响应解析。解析后的 ID 只做 `trim`、过滤空值和精确字符串去重；累计到第 2001 个有效唯一 ID 时整体失败。

## Errors, Cache And Compatibility

- 新错误经过现有 `redactErrorMessage` 边界，不包含 URL query、key 或 header。
- `fetchUpstreamModels` 失败仍以异常返回；admin/panel 只有成功后才写缓存，因此旧值自然保留。
- 不新增配置项、依赖、SSRF allowlist 或模型能力判断。
- 回滚只涉及 `probe.ts` 及定向测试，无数据库或缓存格式迁移。

## Validation

`probe.test.ts` 覆盖：声明/实际 4 MiB、非法 `Content-Length`、1999/2000/2001 模型、空白/重复/大小写、同源 1/5/6 跳、跨源、循环、缺失 Location、OpenAI 兼容/Anthropic/Gemini 三类正常响应、超时与脱敏。
