# MAGI 项目进化第 15 轮

## Goal

修复流式响应已经向客户端输出内容后仍继续切换 Provider key 或路由的问题，避免同一条回复拼接多个上游生成的内容，并保留失败日志、熔断和错误终止语义。

## Background

- `src/lib/stream.ts:293-345` 的 `streamChat` 会在 key 尝试中立即向调用方 `yield` 上游事件；尝试随后抛错时，catch 仍会按错误类型继续换 key，之后还可能进入下一路由。
- `src/lib/stream.ts:520-545` 的 `streamWithRoute` 可以先产出 `text-delta`、`reasoning-delta` 或 `tool-call`，再因上游 `error` part 抛错。已经发送的事件无法从 WebChat 或 OpenAI SSE 客户端撤回。
- 因此首路由先输出 `foo` 后失败、后续路由再输出 `bar` 时，客户端会看到语义来源不同的 `foobar`；同一 Provider 的多 key 重试也存在相同风险。
- 当前 `src/lib/stream-circuit-breaker.test.ts` 只覆盖“尚未输出即失败”，没有约束已输出后的 key/route 故障转移边界。
- 尝试失败日志目前以 `usage: {}` 记录，不能准确保存中途失败前已消耗的 token；这是独立计量问题，不影响本轮先阻止内容拼接。

## Requirements

- `streamChat` 必须区分当前请求是否已经向调用方发出不可撤回事件；`text-delta`、`reasoning-delta` 和 `tool-call` 均属于不可撤回事件。
- 在尚未发出不可撤回事件时，既有多 key 重试、多路由故障转移、错误分类和熔断行为保持不变。
- 一旦发出不可撤回事件，当前上游随后失败时必须停止该请求的所有后续 key 和 route 尝试，并向调用方发出既有的脱敏 `generation_failed` error 事件；不得伪造 finish 或 success。
- 已输出后的失败仍必须执行当前尝试的失败日志、可转移错误的 Provider 熔断上报以及最终 failed 指标；不得因禁止故障转移而跳过健康状态更新。
- Abort 继续按 interrupted 处理，不写普通失败事件、不重试 key、不转移路由。
- 回归测试必须分别覆盖多路由与同 Provider 多 key 场景，并证明首个上游已经输出后，第二个上游调用不会发生、结果不包含第二份内容且以错误事件终止。
- 更新 Gateway Routing 规范，明确流式故障转移只允许发生在不可撤回事件输出之前。

## Acceptance Criteria

- [x] 首路由发出正文增量后再失败时，第二路由未调用，事件序列保留首路由增量并以脱敏 error 事件结束，不包含第二路由内容。
- [x] 同一 Provider 的首个 key 发出正文增量后再失败时，后续 key 未调用，事件序列不发生内容拼接。
- [x] `reasoning-delta` 与 `tool-call` 也建立相同的响应提交边界，不会在其后继续 key/route 故障转移。
- [x] 首次尝试在任何不可撤回事件前失败时，既有 key 重试和路由故障转移继续工作。
- [x] 已输出后的可转移失败仍各记录一次尝试失败，并使对应 Provider 的 breaker failures 增加；最终请求不记录 success。
- [x] Abort、错误脱敏、TTFT、Agent loop 聚合用量和非流式 `generateChat` 行为不回归。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 与 Trellis 校验通过，独立复核无阻塞项。

## Out Of Scope

- 从中途失败的 AI SDK 流中恢复或估算部分 token 用量，或修改 `logAttemptFailure` 的 `usage: {}` 契约。
- 在服务端缓存并回滚整段流后再做无感故障转移；这会改变实时输出延迟与内存边界。
- 修改 `StreamEvent` 类型、WebChat/SSE 协议、前端消息合并逻辑或错误文案。
- 修改非流式 `generateChat` 的路由策略、reasoning/providerOptions 透传或模型目录。
- 修复 `conversations.generating` 并发误清、Embedding Provider 缓存失效或后台 consumer 重试策略。

## Risks And Deferred Items

- 已输出后失败会把部分回复连同 error 一起交给客户端，用户仍需重试，但不会再收到来源混杂且看似完整的错误回复。
- 当前失败尝试没有可靠的部分 usage 数据；本轮保持为空，避免伪造计量。若未来 AI SDK 暴露可在错误前读取的权威用量，再独立扩展日志契约。
- 本轮通过 mock 上游流验证行为，不使用真实 Provider key 或真实网络中断；剩余风险集中在第三方 SDK 对异常流的特殊终止形态。
