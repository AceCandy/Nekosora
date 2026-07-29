# 统一 Gateway execution engine

## Goal

建立一个统一的 Gateway execution module，使 Chat 流式、Chat 非流式、图像生成、TTS 与 STT 共享同一套 route/key 尝试、故障转移、熔断、错误脱敏与尝试审计语义，消除各模态的行为漂移，兑现 Nekusora 的高可用网关目标。

## Background

- `src/lib/stream.ts` 的 `streamChat` 与 `generateChat` 分别维护 route/key retry、breaker 与 usage implementation；现有 spec 要求不可撤回流事件提交后禁止切换上游。
- `src/lib/providers/multimodal/image-gen.ts:65-95` 解析完整 route chain 后固定使用 `routes[0]`，且只使用首个 Provider key；文件注释宣称逐 route 尝试，但 implementation 没有循环。
- `src/lib/providers/multimodal/audio-tts.ts:52-63` 与 `audio-stt.ts:44-53` 同样固定 `routes[0]`，并忽略 `route.protocol` 强制使用 OpenAI adapter。
- `src/lib/routing.ts`、`src/lib/circuit-breaker.ts` 与 `.trellis/spec/backend/gateway-routing.md` 已定义 route 排序、key 选择、breaker 以及流式响应 commit 契约，这些行为是重构输入，不应在各模态重新定义。
- MCP 现有生成路径最终复用 Chat generation；本任务不另改 MCP 对外协议。

## Requirements

- R1. 建立单一 Gateway execution module，集中 route/key 遍历、最大尝试数、错误分类、breaker 反馈、凭据脱敏和 attempt audit 的控制流。
- R2. `streamChat` 与 `generateChat` 必须消费该 module；共享策略不得抹平流式响应的 commit seam。
- R3. 图像生成、TTS 与 STT 必须消费完整 route chain，并在响应尚未提交时按统一规则故障转移。
- R4. 每种模态的请求与响应翻译保留在对应 provider adapter；execution module 不包含协议特有 payload 构造。
- R5. route 解析继续遵守网关 owner-only、WebChat by-id visibility 与子 key binding 契约，不扩大模型可见性。
- R6. 可转移失败必须更新 breaker；确定性请求错误不得污染 provider 健康度；Abort 不重试、不故障转移。
- R7. 每次上游尝试只允许产生一条 attempt audit；最终成功/失败的 usage 与 metrics 不得因重试重复计数。
- R8. execution module 必须在持有明文 key/header 时对原始上游 Error 完成重试判定、分类与精确脱敏；原始 Error 不得跨出 execution 安全域进入 telemetry、console、route 或响应。
- R9. 迁移采用可独立验证、可回滚的垂直切片；在旧 implementation 删除前，新旧行为需要 characterization tests 锁定。
- R10. 允许破坏性统一内部错误分类、attempt/usage 口径和终态语义；新语义必须形成单一明确契约并提供数据/调用方迁移说明。
- R11. `/v1/*` 仍须保持 OpenAI SDK 可调用的 wire contract；若可靠实现核心目标必须破坏该产品承诺，必须另行提请批准。
- R12. 允许破坏性替换并清空旧 `usage_logs` 与 `ops_error_logs` 数据，建立统一 execution/attempt 日志事实模型；清理范围不得包含 `runs`、`tool_calls` 或任何业务数据。

## Acceptance Criteria

- [ ] Chat 流式、Chat 非流式、图像、TTS 与 STT 均通过同一个 execution policy 驱动 route/key 尝试。
- [ ] 首 route 或首 key 在提交前发生可转移失败时，存在候选则尝试下一 key/route，并记录失败 attempt 与 breaker 反馈。
- [ ] 流式响应输出 text、reasoning 或 tool-call 后失败时不再切换上游，保留已有输出并发送现有脱敏错误终态。
- [ ] Abort 在所有模态中停止后续尝试，且不伪装为普通 provider 失败。
- [ ] 图像、TTS、STT 的双 route 回归测试证明首 route 失败后第二 route 可成功；不支持的 protocol 在 adapter seam 处得到确定、脱敏的失败。
- [ ] 主/子 key、WebChat/网关可见性、route 优先级/权重、breaker half-open 行为保持既有 contract tests。
- [ ] 成功 usage、失败 attempt audit、metrics 与脱敏测试覆盖单 route、换 key、换 route、最终失败和 Abort 矩阵。
- [ ] 旧日志/usage 口径与新 attempt/final outcome 口径的差异有明确迁移说明；所有管理页查询和 metrics 消费方完成适配。
- [ ] PostgreSQL 迁移只删除/替换旧日志审计表及其数据，不改动消息、run/tool call、模型、Provider、route 与 API key 数据；Drizzle journal/snapshot 同步。
- [ ] 旧的重复 retry implementation 被删除；删除新 execution module 会使所有模态的共同契约测试失败，证明 module 具有 leverage。

## Out of Scope

- 不改变模型目录、route schema、Provider 所有权或密钥存储格式。
- 不把进程内 circuit breaker 改造成 Redis/数据库分布式 breaker。
- 不修改 OpenAI 兼容端点的业务功能集合，也不单独重构 MCP transport。
- 不在本任务中处理 Chat completion 的消息持久化、run 终态与 SSE `[DONE]` 事务；该工作按推荐顺序作为下一任务。

## Key Decision

- 用户接受破坏性统一：错误分类、usage/attempt 口径和内部终态可改变，以换取一个一致、可验证的 execution contract。
- OpenAI SDK wire compatibility 仍属于产品核心目标，不包含在默认可破坏范围内。
- 项目尚未上线，允许直接清空并替换 `usage_logs` / `ops_error_logs`；无需回填、归档或兼容旧日志数据。该授权不扩展到 `runs`、`tool_calls` 或业务数据。
