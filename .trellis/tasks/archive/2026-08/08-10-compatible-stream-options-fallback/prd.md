# OpenAI-compatible stream_options 自动降级

## Goal

让网关透明兼容不接受 `stream_options` 的 OpenAI-compatible 上游，同时保留支持该字段的上游流式 token 用量，不要求调用者或管理员手动切换 Provider 配置。

## Background

- OpenAI 客户端会在调用网关 `/v1/chat/completions` 时发送标准字段
  `stream_options: { include_usage: true }`。当前入口 parser 未把该字段列入允许集合，
  请求在路由执行前就返回 `400 request.unsupported_parameter`；此类失败不会产生上游
  attempt，不能靠 Provider 能力学习修复。
- `packages/core/src/lib/providers/registry.ts:83-90` 当前对所有 `openai-compatible + openai-chat` 路由固定设置 `includeUsage: true`。
- 项目锁定的 `@ai-sdk/openai-compatible@3.0.12` 会把该选项编码成流式请求体中的 `stream_options: { include_usage: true }`。
- 报错上游返回 HTTP 400，并明确声明 `Unsupported parameter: 'stream_options'`；请求在产生任何响应事件前失败。
- `gateway_executions` / `gateway_attempts` 要求每个真实上游请求都保留 attempt 事实，自动降级不能藏在 SDK fetch 包装器内。

## Requirements

- OpenAI Chat 入口接受 `stream_options`，仅允许可选布尔字段 `include_usage`；未知子字段仍按
  现有协议边界返回明确的 `400 Unsupported parameter`。
- 入站 `stream_options` 只描述调用方期望的网关响应，不得原样透传到上游；上游字段继续由
  Provider adapter 独立生成和协商。
- 默认继续向尚未判定不支持的 OpenAI-compatible Chat 上游发送 `stream_options.include_usage=true`。
- 仅当 HTTP 400 错误同时明确引用 `stream_options` 和 unsupported/unknown/unrecognized 等拒绝语义时触发自动降级；普通 400、鉴权、限流、网络或其他参数错误不得触发。
- 降级只适用于 `protocol=openai-compatible` 且 route `apiFormat=openai-chat` 的流式调用；官方 OpenAI、Responses、Anthropic、Gemini 和非流式调用保持原行为。
- 在尚未提交任何客户端可见事件时，网关记录第一次失败 attempt，标记该 Provider endpoint 不支持流式 usage，然后使用同一路由、同一 key 重试一次。
- 降级重试不得计入 Provider breaker failure；重试成功后逻辑 execution 成功且只终结一次。
- 能力自动持久化到具体上游 Provider：`null` 表示待探测，`false` 表示已确认不支持。重启及多 Gateway 实例共享该结论。
- 持久化更新必须同时匹配 Provider ID 与本次解析到的 Base URL，防止迟到请求覆盖已经换址的 Provider。
- 任意 Provider 配置保存后将能力恢复为待探测，让改变后的上游重新协商。
- 同一逻辑请求最多进行一次该兼容性重试；重试后仍失败则按既有错误与故障转移规则收敛，不得循环。
- 新增 Provider 内部可空布尔字段及 PostgreSQL 迁移，但不增加后台手动开关。

## Acceptance Criteria

- [ ] `/v1/chat/completions` 携带 `stream: true` 与
  `stream_options: { include_usage: true }` 时能进入生成链路，不再在入口返回 400。
- [ ] `stream_options` 的未知子字段仍返回准确参数路径的 400，且不触发上游。
- [ ] 支持 `stream_options` 的 OpenAI-compatible 上游仍收到该字段，并保持现有 usage 行为。
- [ ] 明确拒绝 `stream_options` 的上游第一次调用表现为同 key 的 `400 -> 无该字段重试 -> 成功`，客户端看不到第一次 400。
- [ ] 第一次失败和第二次成功分别记录 attempt，最终 execution 只记录一次成功。
- [ ] 学习后同一 Provider 的后续调用及 Gateway 重启后的调用首发即不带 `stream_options`；其他 Provider 不受影响。
- [ ] Provider 配置保存后恢复待探测；迟到的旧 Base URL 请求不能把新配置标为不支持。
- [ ] 普通 400、仅出现 `stream_options` 但没有拒绝语义、仅出现 unsupported 但没有字段名、HTTP 5xx 均不触发学习或同 key 重试。
- [ ] 已提交正文、推理或工具事件后不得降级重试。
- [ ] 兼容性失败不更新 Provider breaker；真实重试失败继续遵守既有 breaker/故障转移规则。
- [ ] 定向单测、Core 类型检查和相关 lint 通过。

## Out Of Scope

- 后台手动覆盖或展示该内部能力。
- 本次修复之外的 OpenAI-compatible 可选字段自动协商。
- 本地估算缺失 token 或改变现有 usage 聚合规则。

## Risks And Deferred Items

- 已经并发解析出旧 Provider 状态的请求可能各自发生一次兼容性 400 和重试；数据库更新只消除后续请求的重复探测。
- Provider 的任意配置保存都会重新探测一次，即使只修改名称；这是用最小更新逻辑避免陈旧能力状态的保守取舍。
