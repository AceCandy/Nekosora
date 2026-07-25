# MAGI 三脑项目优化：首轮设计

## 1. 范围与边界

首轮只修改两个既有后端路径：

1. `src/lib/stream.ts` 的 `streamChatWithTools` 多工具结果入下一轮消息逻辑。
2. `src/app/v1/chat/completions/route.ts` 的流式响应取消传播与取消后写入保护。

不改变数据库、Provider 适配器、公开请求/响应字段、工具执行顺序或前端行为。

## 2. 多工具调用消息序列

### 当前行为

`pendingToolCalls` 按顺序执行时，每次循环立即追加一条 assistant 消息和一条 tool 消息。两个工具得到：

```text
assistant(tool_calls=[call-1])
tool(call-1)
assistant(tool_calls=[call-2])
tool(call-2)
```

这破坏了一轮模型响应的原子性，部分 OpenAI 兼容 Provider 会拒绝下一轮请求。

### 目标行为

保持工具串行执行和 `tool-result` 事件逐个透传；执行时收集 tool 消息。全部执行后，一次性追加：

```text
assistant(tool_calls=[call-1, call-2])
tool(call-1)
tool(call-2)
```

`tool_calls` 与 tool 消息均沿用模型返回顺序，工具异常仍序列化为对应 tool 内容并继续下一轮。

## 3. 网关取消生命周期

`streamResponse` 继续拥有局部 `AbortController`。消费者调用 `ReadableStream.cancel()` 时：

1. `cancel()` 中止该控制器。
2. 同一 `signal` 传给 `streamChat`，由现有 `streamWithRoute` 传至上游 AI SDK。
3. `start()` 检测已取消状态，不再写 `[DONE]` 或错误帧，也不再对已取消流调用 `close()`。

正常结束仍写 `[DONE]` 并关闭；非取消异常仍写 OpenAI 风格 SSE 错误帧并关闭。首轮不合并 `NextRequest.signal`，避免扩大生命周期语义；公开 body 取消路径已覆盖当前控制器的原始设计意图。

## 4. 兼容性与回滚

- 单工具请求的消息形状不变。
- 工具调用与结果事件顺序不变。
- 正常网关 SSE 帧与响应头不变。
- 无数据迁移、配置或依赖变更。
- 两项修改位于独立代码块，可分别回滚；测试也分别归属现有 Agent loop 测试与新增 route 测试。

## 5. 风险

- AI SDK 的流取消可能以正常结束或 AbortError 表现，路由测试需覆盖取消后的微任务收尾，避免未处理 rejection。
- 多工具测试必须检查第二次 `streamText` 收到的完整 `messages`，只检查外发事件不足以证明 Provider 请求格式正确。
