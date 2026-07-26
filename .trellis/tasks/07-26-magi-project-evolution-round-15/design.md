# Technical Design

## Boundary

改动限定在 `src/lib/stream.ts` 的 `streamChat` 尝试循环、`src/lib/stream-circuit-breaker.test.ts` 的行为回归测试和 `.trellis/spec/backend/gateway-routing.md` 的流式故障转移契约。

不修改 `streamWithRoute` 的事件翻译、`StreamEvent` 联合类型、路由解析、key 排序、AI SDK 重试配置、日志 schema、前端或非流式 `generateChat`。

## Response Commitment Contract

每次 `streamChat` 请求维护一个布尔状态，初始为未提交。以下事件在向调用方 `yield` 前把状态置为已提交：

- `text-delta`
- `reasoning-delta`
- `tool-call`

这些事件已经进入 WebChat 或 SSE 消费链，无法由服务端撤回。`finish` 表示正常完成，不存在后续故障转移；当前实现不从 `streamWithRoute` 产出独立 `usage` 事件，因此不扩大提交事件集合。

## Failure Flow

```text
streamWithRoute event
  -> text/reasoning/tool-call?
       yes -> mark response committed before yield
  -> later upstream error
  -> classify + redact error
  -> abort?
       yes -> interrupted, stop
       no  -> logAttemptFailure
             -> response committed?
                  yes -> do not try another key
                  no  -> preserve existing key retry decision
  -> route-level failoverable check
  -> recordFailure when applicable
  -> response committed?
       yes -> do not try another route
       no  -> preserve existing route failover decision
  -> yield existing generation_failed error event
```

提交状态必须在 `yield` 前更新，确保上游生成器恢复后抛错时 catch 能观察到该状态。它属于整个 `streamChat` 请求而非单个 key；一旦为真就不可回退。

## Preserved Contracts

- 每次真实失败仍调用 `logAttemptFailure`，attempt 序号与脱敏行为不变。
- 路由级 `isFailoverableError` 判定和 `recordFailure` 顺序不变；禁止后续路由不等于忽略 Provider 健康失败。
- 未输出时的多 key 与多路由容灾不变。
- Abort 在普通失败日志之前短路，维持 interrupted 语义。
- `finalUsage`、TTFT、最终 failed metrics 和 Agent loop 对 error 事件的处理不变。

## Test Design

1. 多路由 tracer bullet：首路由 mock 流依次产出正文和 error，第二路由若被调用会产出不同正文；断言调用次数为 1、事件中只有首路由正文且末尾为 error。该测试在修复前会得到两段正文并调用两次上游。
2. 最小实现：增加请求级提交状态，在事件输出前标记，并把 key/route 重试条件同时受该状态约束。
3. 同 Provider 多 key：配置两个 key，首个实际尝试产出正文后失败；断言 `streamText` 只调用一次并以 error 结束。
4. 将多路由用例扩展到 reasoning 和 tool-call 事件，守住完整不可撤回事件集合。
5. 保留现有“未输出即失败”的 circuit-breaker 用例，并补断言已输出失败仍上报 breaker、记录 attempt failure 且不写 success。

测试只 mock AI SDK 和数据库仓储等系统边界，调用公开 `streamChat` 接口，不导出或测试内部状态。

## Compatibility And Trade-Offs

- 选择“首个不可撤回事件后停止故障转移”，因为流式输出无法事务性回滚；继续容灾必然可能拼接语义不一致内容。
- 不用 `timing.firstTokenAt` 代替提交状态：它只覆盖 text/reasoning，不覆盖 tool-call，且计时与正确性状态不应混用。
- 不缓冲首路由完整结果再输出：虽然可保留透明故障转移，但会把流式接口退化为高延迟、高内存的非流式行为。
- 不新增 helper；事件判断只在一个循环使用，内联条件更直接且 diff 更小。

## Rollback

无 schema、数据或协议迁移。回滚代码与测试提交即可恢复原行为；规范条目随同回滚。若修复引入异常，可临时恢复旧重试条件，但会重新暴露多上游内容拼接风险。
