# Stream Failover After Output Research

## Confirmed Data Flow

```text
streamChat
  -> resolve ordered routes
  -> route A / key A
  -> streamWithRoute
       -> yield text-delta / reasoning-delta / tool-call
       -> later error part throws
  -> streamChat catch logs failed attempt
  -> retry another key or route
  -> yield a second upstream's events into the same client stream
```

- `src/lib/stream.ts:293-345`：外层循环收到事件后立即 `yield`，catch 后按 `isRetryableForKey` 和 `isFailoverableError` 继续容灾。
- `src/lib/stream.ts:459-545`：`streamWithRoute` 转发正文、推理和工具调用；上游 `error` part 随后会抛给外层。
- `src/lib/providers/types.ts:114-121`：这些事件是统一公开 `StreamEvent`，WebChat 与网关 SSE 都消费同一流。
- `src/lib/stream.ts:329-336`：每次失败通过 `logAttemptFailure` 写独立失败记录，当前 usage 固定为空。
- `src/lib/stream.ts:353-354`：route 失败在决定是否继续前上报 breaker；该顺序必须保留。

## Root Cause

故障转移循环只根据错误类别和候选是否剩余作决策，没有记录输出是否已经跨过不可回滚边界。该逻辑适合非流式请求或尚未输出的流式握手失败，但不适合已经把增量交给客户端的流。

路由级和 key 级容灾共享同一缺口：它们都重新发送完整 messages，新的上游不知道客户端已经收到旧上游的前缀，因此无法保证续写一致性。

## Event Boundary

- `text-delta`：正文已经可见，必须提交。
- `reasoning-delta`：推理内容已经可见，必须提交。
- `tool-call`：调用标识、名称和参数已经进入 Agent/UI 状态，必须提交。
- `finish`：成功终态，正常路径不会再容灾。
- `error`：由 `streamChat` 在所有尝试结束后统一产出，不是开始提交成功内容的信号。
- `tool-result`：由外层 Agent loop 在一个 `streamChat` 步骤成功完成后产生，不来自单次 `streamWithRoute` 尝试。
- `usage`：当前 `streamWithRoute` 不单独产出；本轮不为未来假设扩展状态机。

## Reproduction

多路由：

```text
route A -> text-delta("foo") -> error(timeout)
route B -> text-delta("bar") -> finish
current result: "foobar" + success
required result: "foo" + generation_failed error; route B never called
```

同 Provider 多 key：

```text
key A -> text-delta("foo") -> error(429/timeout)
key B -> text-delta("bar") -> finish
current result: "foobar" + success
required result: "foo" + generation_failed error; key B never called
```

## Minimal Fix Boundary

在 `streamChat` 内维护一次请求级 `responseCommitted`：不可撤回事件输出前置为 true；catch 仍先执行错误脱敏与尝试日志，key 级重试要求 `!responseCommitted`；路由级仍先判定并上报 breaker，继续下一路由要求 `!responseCommitted`。

无需修改 `streamWithRoute`、消费者、事件类型或数据库。该状态只回答“还能否无损重新执行完整请求”，不参与 TTFT 或 usage 计量。

## Pre-Fix Coverage Gap

`src/lib/stream-circuit-breaker.test.ts` 已覆盖：

- 唯一路由未输出即发生可转移错误时 breaker 增加。
- 确定性错误不增加 breaker。
- 错误事件、尝试日志和 console 不泄露 key/header。

修复前缺少：

- 首个不可撤回事件后的多路由禁止转移。
- 首个不可撤回事件后的同 Provider 多 key 禁止重试。
- 后续上游未调用与最终不记录 success 的断言。
- reasoning/tool-call 作为提交边界的覆盖。

## Deferred Candidates

- `conversations.generating` 是无 run 归属的布尔值，并发请求可能互相清理；可靠修复需要 conversation run token/CAS 或计数器 schema 设计。
- Embedding Provider 更新、停用或删除不会失效进程缓存；需先确定禁用与悬空设置策略。
- 后台 consumer 捕获异常后直接结束；需先定义幂等、重试分类、backoff 与永久失败语义。
- 非流式 `generateChat` 没有完整透传 reasoning/providerOptions；影响面小于当前用户可见内容污染。

这些候选保持独立，避免把 schema、缓存生命周期或后台可靠性决策混入本轮小范围修复。

## Break-Loop Analysis

### 1. Root Cause Category

- **Category**：B - Cross-Layer Contract，伴随 D - Test Coverage Gap 与 E - Implicit Assumption。
- **Specific Cause**：容灾循环只建模“错误是否可重试”，没有建模事件从服务端生成器跨到 WebChat/SSE 后已经不可撤回；普通请求“失败后完整重试”的隐式假设被直接复用于实时流。
- **Evidence**：修复前回归测试稳定观察到首路由已经产出正文后 `streamText` 仍调用两次；加入请求级提交状态后，同一公开接口测试只调用一次，且日志与 breaker 断言继续通过。对根因判断置信度高于 95%。

### 2. Why Earlier Protection Was Incomplete

1. 既有路由与 key 测试只覆盖上游在首个事件前失败，证明了容灾和 breaker，却没有覆盖流的不可回滚阶段转换。
2. `timing.firstTokenAt` 已能观察正文/推理首 token，但它只服务 TTFT，且不覆盖 tool-call；把它隐式当作正确性状态既不完整也没有契约。
3. key 与 route 是两层独立循环，只在其中一层停止仍会继续调用另一个上游，因此需要一个请求级单向状态同时约束两层。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | 在 `streamChat` 建立请求级 `responseCommitted`，不可撤回事件输出前置位，并同时约束 key/route。 | DONE |
| P0 | Test Coverage | 覆盖 text/reasoning/tool-call、多路由、多 key、日志、breaker，以及未输出时仍容灾的反向用例。 | DONE |
| P0 | Documentation | 在 Gateway Routing 增加七节流式响应提交契约、矩阵、案例和错误/正确代码。 | DONE |
| P1 | Review | 修改流式重试时同时检查输出提交边界、两级循环和失败审计顺序。 | DONE |

### 4. Systematic Expansion

- **Similar Issues**：WebChat、OpenAI SSE、compact 和 Agent loop 都复用 `streamChat`，共享修复覆盖全部消费者；非流式 `generateChat` 在返回前没有不可撤回输出，不适用该状态。
- **Design Improvement**：把“能否重试”拆成错误可转移性与响应可回滚性两个正交条件；前者决定 breaker，后者决定能否启动另一上游。
- **Process Improvement**：以后审查流式容灾必须同时写正向失败前容灾与反向输出后停止用例，不能只验证最终成功/失败。

### 5. Knowledge Capture

- [x] `backend/gateway-routing.md` 已记录完整可执行契约。
- [x] `stream-circuit-breaker.test.ts` 已建立跨公开接口的回归矩阵。
- [x] 该规则属于 Gateway 流式实现细节，不在通用 thinking guide 重复维护。
- [x] 仓库不存在 `src/templates/markdown/spec/`，本轮无模板同步目标，未创建推测性目录。
