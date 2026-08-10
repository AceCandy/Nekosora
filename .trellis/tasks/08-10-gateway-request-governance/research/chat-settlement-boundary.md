# Chat 预留与结算边界调研

## 外部请求边界

- `packages/core/src/lib/protocols/handler.ts:16-36` 是 OpenAI Chat/Responses、Anthropic Messages 与 Gemini generate/stream 的统一入口；认证、JSON 解析和协议解析后只选择一次流式或非流式 encoder。
- `packages/core/src/lib/protocols/encoders.ts:129-150` 的非流式 `collect` 与 `:385-455` 的流式 `ReadableStream` 都只消费一次 `streamChat`。因此请求级速率、预留 ID 和响应生命周期应从该边界建立。
- 请求速率检查可在鉴权后、读取大 body 前完成；Chat 配额必须在协议解析并得到可计量 IR 后、首次 Provider attempt 前完成。

## 重试与多轮边界

- `packages/core/src/lib/stream.ts:195-219` 在 tools/protocol 不兼容且尚未提交响应时，会移除 tools 并重新创建一次 `executeGateway` execution。把预留放在 execution 层会对同一客户端请求重复扣减。
- `packages/core/src/lib/gateway-execution/engine.ts:38-55,252-315` 为每个 execution 生成独立 ID；路由与上游 Key 重试只递增 attempt。AI SDK 已使用 `maxRetries: 0`，但 execution ID 仍不是客户端请求幂等键。
- `packages/db/src/schema.ts:932-1021` 的 `gateway_executions.requestId` 只有普通索引，不能直接充当唯一结算账本。治理层需要独立且唯一的请求 ID，并由协议入口贯穿工具降级和所有 attempt。
- `streamChatWithTools` 的 Agent 多轮会共享 `agentRunId` 并最终聚合 usage，但 session 鉴权 Web Chat 不属于本次 API Key 治理范围；实现共享 helper 时不得让每个内部步骤重复预留。

## 终态

- `packages/core/src/lib/stream.ts:232-277` 的外层 `finally` 能观察成功、失败与中断；流式 encoder 的 `finally` 负责响应关闭。治理应使用一次性 finalize，并让 body 完成、取消和 abort 都进入同一释放路径。
- Chat usage 来自 SDK `result.usage`；现有落库对缺失字段使用 0。治理不能复用这个观测默认值作为计费事实，而应在 usage 缺失时保留预留值。
- Provider 尚未开始时失败可退款；开始后 usage 缺失则按预留结算。终态事务先锁定治理请求行，只有未结算行才能调整月度桶并释放租约，重复调用直接返回既有结果。
