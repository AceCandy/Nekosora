# 加固上游模型列表拉取

## Goal

在共享 `fetchUpstreamModels` 边界限制不受信任上游响应，避免内存放大、异常缓存写入和重定向导致的凭据泄露。

## Background

- `probe.ts:436-475` 统一服务 admin 和 panel 的模型发现、刷新及缓存回退。
- 当前 Provider connect/read 超时受 15 秒探测上限约束，异常会经现有脱敏逻辑处理。
- 当前成功响应直接 `res.json()`；无字节上限、模型数量上限和显式 redirect 策略。
- admin/panel 的落库 helper 只有 fetch 成功后才更新 `upstreamModels`，异常时旧缓存保持不变。

## Requirements

- R1：在读取 JSON 前执行 4 MiB 硬上限；既检查可信的 `Content-Length`，也对流式读取的实际字节数计数。
- R2：解析后最多接受 2000 个有效模型；超过上限整体失败，不静默截断或落库部分结果。
- R3：最多跟随 5 次同 origin 重定向；拒绝跨 origin、无效 Location 和重定向循环，Gemini query key 不得传播到其他 origin。
- R4：保持现有 15 秒总读取上限、connect timeout、错误脱敏、协议解析和失败不覆盖旧缓存语义。
- R5：模型 ID 仅做 trim、过滤空值和精确字符串去重；不改变大小写，不推断模型能力。
- R6：沿用共享核心函数覆盖管理员与用户 BYO Provider，不在 admin/panel 各补一份保护。

## Acceptance Criteria

- [x] 声明或实际响应体超过 4 MiB 时返回脱敏错误，JSON 不被解析，旧缓存不变。
- [x] 有效模型超过 2000 个时整体失败；恰好 2000 个正常返回。
- [x] 同 origin 重定向在 5 次内可用；跨 origin、缺失 Location、循环或超过次数均失败。
- [x] OpenAI 兼容、Anthropic 和 Gemini 的正常响应继续按现有结构解析。
- [x] 重复和空白模型 ID 被稳定清理，大小写不同的 ID 不合并。
- [x] 定向测试覆盖超时、字节限制、数量限制、重定向、脱敏和缓存保持。

## Out of Scope

- 完整首跳 SSRF 私网阻断、Provider URL allowlist 或 DNS rebinding 防护。
- 自动创建模型目录项、能力推断或修改现有模型路由结构。
- 把限制开放为管理员配置项。
