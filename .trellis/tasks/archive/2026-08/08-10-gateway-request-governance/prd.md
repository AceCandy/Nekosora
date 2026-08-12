# Gateway 请求流量治理

## Goal

为公网 API Key 鉴权的 Gateway 模型/API 入口（包括 `/v1/*` 与 Gemini `/v1beta/models/*`）建立按 API Key/用户执行的多实例一致资源边界，限制突发请求、并发流和可计费消耗。

## Background

- `packages/core/src/lib/protocols/handler.ts:25-36` 在认证与解析后直接进入响应编码链路。
- `packages/contracts/src/routes.ts:1-22` 与 `apps/gateway/src/handlers.ts:38-56` 映射 `/v1/*` 及 Gemini `/v1beta/models/*` handler；仓库检索未发现按 `apiKeyId`/用户执行的限流、配额或并发拒绝策略。
- `packages/core/src/lib/infra/cache.ts:17-73` 只有可降级的 Redis/内存缓存与 `get/set/delete/wrap`，不能提供多实例原子计数或租约；PostgreSQL 是现有必需依赖并已有事务、行锁和租约模式。
- `verifyKey` 已提供 `userId`、`apiKeyId` 和 `keyKind`；原始 API Key 不需要进入治理状态、日志或指标。
- Chat 能取得 token usage；Image、TTS、STT 当前没有统一 token usage，强行共用 token 配额会产生错误计费语义。

## Requirements

- R1. 在鉴权成功后先执行按 `apiKeyId` 与用户归属的请求速率检查；会产生 Provider/RAG 工作的入口还必须在 Core 语义解析和上游调用期间持有并发租约，并在得到可靠计量单位后、首次 Provider attempt 前完成额度预留。
- R2. 多 Gateway 实例下计数必须原子且可恢复，进程退出、客户端断开和异常终态都要释放并发租约。
- R3. 超限响应保持 OpenAI 兼容的 HTTP 状态和错误体，明确区分速率、并发与配额原因，并提供合理 `Retry-After`。
- R4. 请求速率策略覆盖所有 API Key 鉴权的 Gateway 入口，包括 Gemini `/v1beta/models/*`；并发与配额按会产生 Provider/RAG 工作的操作执行。流式租约持续到响应完成、取消或中断，不能只限制连接建立。
- R5. 每个 Key 使用独立 Key 桶，主/子 Key 同时共享所属用户桶；任一维度触顶即拒绝，不改变现有父 Key 禁用和子 Key 模型绑定语义。
- R6. 指标和日志只记录必要标识，不记录原始 API Key；测试覆盖并发竞争、异常释放、窗口切换和多实例语义。
- R7. PostgreSQL 是治理状态唯一正确性来源；检查失败时不得回退到进程内计数或静默放行。
- R8. 管理员拥有全局策略配置；首期不增加用户自助或单 Key 覆盖。所有阈值必须是大于零的有界安全整数，整组校验成功后才能原子保存。
- R9. 本任务完整覆盖多模态配额：Chat 按 token、Image 按图片张数、TTS 按 Unicode code point、STT 按音频时长分别预留、结算和退款；不同单位不得伪装成统一 token 或请求次数。TTS 保留现有 4096 输入上限，并以同一 code-point 口径校验。
- R10. 每种计量必须来自可靠的请求事实或实际结果；请求前无法形成可靠 reservation 时必须拒绝且不得调用 Provider。Provider 已开始后若缺失可靠 actual usage，则按 reservation 保守结算。
- R11. 同一客户端请求的工具降级、路由/Key 重试和 Provider 尝试共享一个治理请求 ID，只预留并结算一次；内部执行 ID 与 attempt 不能作为重复扣减依据。
- R12. 管理配置必须先完整校验再原子保存，运行时对缺失配置使用已确认默认值；非法配置不得导致绕过治理或让请求路径传播 `NaN`、负数等无效状态。
- R13. 默认策略在迁移后立即启用，额度周期为 UTC 自然月；治理租约固定 120 秒并每 30 秒单飞续租，稳定性时序不开放管理员修改。

## Default Policy

| 维度 | 单 Key | 单用户 |
|---|---:|---:|
| 每分钟请求数 | 120 | 600 |
| 突发容量 | 30 | 120 |
| 并发 | 8 | 32 |
| Chat token/月 | 10,000,000 | 50,000,000 |
| Image 张/月 | 1,000 | 5,000 |
| TTS Unicode code point/月 | 1,000,000 | 5,000,000 |
| STT 秒/月 | 36,000 | 180,000 |

## Acceptance Criteria

- [ ] 无外部 WAF 时，单个 Key 也不能无限建立请求或流式连接。
- [ ] 超限不会调用 Provider，正常请求和现有鉴权行为不受影响。
- [ ] OpenAI、Responses、Anthropic、Gemini `/v1beta/models/*`、Image、TTS、STT、Models 与 MCP 的 Endpoint Matrix 均有定向测试，不存在因路径前缀不同而绕过治理的入口。
- [ ] 多实例测试证明计数原子、租约可回收、重启后不会永久占额。
- [ ] acquire、heartbeat、Provider-start、finalize 与过期回收的交叉并发无死锁；同一 reservation 只退款或转入 used 一次，活动租约表不会因失联请求永久增长。
- [ ] 主 Key 与多个子 Key 的并发请求同时受用户共享上限约束，不能通过增加子 Key 绕过。
- [ ] 正常完成、异常、客户端取消和连接关闭立即释放租约；进程退出或续租失败后最多 120 秒恢复并发名额。
- [ ] 拒绝响应使用协议兼容错误体、稳定机读错误码和 `Retry-After`，且不包含原始 Key；OpenAI 风格响应使用独立 `error.code`，所有协议同时返回统一的稳定错误码 header。
- [ ] Chat、Image、TTS、STT 分别证明预留、成功结算、Provider 开始前失败退款、开始后缺失 usage 的保守结算、中断结算和重复终态幂等，多次 Provider 尝试不会重复扣减同一客户端请求。
- [ ] STT 配额使用可验证的音频时长，不以压缩文件字节数近似；损坏或不支持计量的音频在调用 Provider 前拒绝。
- [ ] PostgreSQL policy/admission 或 Provider-start 标记故障在触网前返回 `server.service_unavailable` 503；heartbeat/settlement 故障不得触发后续 Provider attempt、route/key failover 或 breaker 更新。响应已提交的流式请求使用协议内服务不可用终态，因为 HTTP 状态已不可更改。
- [ ] 管理员可查看并修改全局 Key/用户速率、突发、并发与四类月额度；越界配置整组拒绝，旧部署缺少配置时行为确定。
- [ ] 默认策略、UTC 月切换、120/30 秒租约时序和即时启用行为均有自动化断言。
- [ ] `pnpm check`、`pnpm test`、Web/Gateway 生产构建与独立复核通过。

## Out Of Scope

- 账单支付系统或套餐营销功能。
- 将上游 Provider 的 429 当作客户端配额状态。
- IP、设备指纹或外部 WAF 维度的匿名攻击限流。
- 改变主 Key 禁用对子 Key 的现有行为，或顺带修复 `parentId` 完整性。
- 将 session 鉴权的 `/api/*`（包括 Web Chat/Agent、图片、上传与知识检索）并入本次 API Key 治理。
- 用户自助、用户级覆盖、单 Key 覆盖或套餐优先级体系。
- 与可靠计量无关的 Image `size`/`response_format`、TTS `response_format` 兼容性收紧。
