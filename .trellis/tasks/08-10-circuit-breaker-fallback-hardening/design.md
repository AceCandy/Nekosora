# 熔断降级策略加固设计

## 1. Boundaries

本任务只修改进程内 Provider 熔断、共享 Gateway Engine、错误映射和低基数观测。路由数据库、Provider 配置、权重算法、协议请求体和管理 UI 不变。

现有缺陷由两个边界错位共同造成：

1. 路由解析调用 `isProviderAllowed()` 时已经占用 half-open 名额，但没有把所有权交给执行引擎。
2. 所有路由被拒绝时，`filterByCircuitBreaker()` 返回原始全集，直接绕过 `open` 和已占用探针。

只把过滤结果改为空数组不能解决问题：它既无法表达拒绝原因，也会让 `resolveRoutesByCapability()` 把无健康路由误判为能力不支持。

## 2. State And Permit Contract

`circuit-breaker.ts` 继续作为 Provider 进程内状态的唯一 owner。状态仍为 `closed | open | half-open`，增加仅在 half-open 有效的一次性 probe token。

### 2.1 Pure availability

新增无副作用的 availability 查询，返回以下固定结果：

| Result | Meaning | Routing behavior |
| --- | --- | --- |
| `closed` | Provider 正常 | 保留路由 |
| `probe_ready` | `openUntil` 已到且尚无探针 | 保留路由，Engine 再原子获取许可 |
| `open` | 冷却未到 | 过滤路由 |
| `probe_busy` | 唯一探针已占用 | 过滤路由 |

该查询不改变状态，避免路由解析提前占用探针。

### 2.2 Execution permit

`GatewayBreakerPort` 改为获取一个许可：

```ts
interface GatewayBreakerPermit {
  recordSuccess(): void;
  recordFailure(): void;
  release(): void;
}

interface GatewayBreakerPort {
  acquire(providerId: string): GatewayBreakerPermit | null;
  recordNoHealthyRoute(): void;
}
```

- `closed` 获取普通许可。成功/失败继续复用现有计数语义，`release()` 无额外状态迁移。
- `probe_ready` 原子转为 `half-open`，生成 token 并返回探针许可。
- `open` 或 `probe_busy` 返回 `null`。
- 探针许可在一个 route 的有界 Key 重试期间保持唯一；这允许现有同 Provider Key fallback，但禁止另一个请求并发探测。
- 探针许可先锁存本次 route 是否出现 Provider 失败或最终成功，统一在 `release()` 结算。只要同一许可最终成功，成功优先于前序 Key 失败；没有成功时，任一可转移失败使最终结果为失败。这保持“前一 Key 失败、后一 Key 成功则 Provider 恢复”的现有语义。
- `release()` 幂等且校验 token。旧请求的迟到终态不能结算新的探针。

### 2.3 Probe terminal table

| Terminal evidence | Probe transition | Cooldown |
| --- | --- | --- |
| Adapter 成功 | `half-open -> closed`，失败计数清零 | 清除 |
| 可转移 Provider 失败 | `half-open -> open` | 从失败时刻重新计算 |
| Provider timeout | `half-open -> open` | 从失败时刻重新计算 |
| Caller cancel / Abort | `half-open -> open` | 保留已到期的 `openUntil`，可立即重新竞争 |
| Deterministic request error | `half-open -> open` | 同上 |
| Adapter/能力拒绝、空 Key、Provider-start 失败 | `half-open -> open` | 同上 |

中性释放不代表 Provider 健康，也不制造新的失败；保留已经到期的冷却时间，让下一条真正可执行的请求重新竞争唯一探针。

## 3. Request Flow

```text
DB routes
  -> orderRoutes(priority / weight)
  -> pure breaker availability filter
     -> none: routing.no_healthy_route
     -> candidates
  -> Gateway Engine acquire(provider)
     -> denied by concurrent probe: skip route
     -> permit acquired
        -> adapter selection / bounded key attempts
        -> record success or failoverable provider failure
        -> finally release permit
  -> all acquire calls denied: routing.no_healthy_route
```

路由层负责配置路由与 availability 的静态快照；Engine 负责原子许可、route/key 执行和所有终态释放。两层都处理并发窗口：路由层先过滤，Engine 获取失败时再次 fail closed。

## 4. Routing Behavior

- `filterByCircuitBreaker()` 保留 `closed` 和 `probe_ready` 路由。
- 过滤后为空时记录一次无健康路由事件并抛稳定 `RoutingError`，不返回原始全集。
- 删除无生产调用者且包含相同 fail-open 行为的 `filterAllowedOrFallback()`。
- `resolveRoutesByCapability()` 继续只接收非空路由，因此不会把熔断拒绝误判为 `capability_not_supported`。
- Engine 在路由解析与许可获取之间发生竞争时跳过未获许可的 route；若没有任何许可且没有更优先的 request/adapter rejection，则返回同一稳定错误。

## 5. Error Contract

新增 `ErrorCode.ROUTING_NO_HEALTHY_ROUTE = "routing.no_healthy_route"`：

- `ERROR_META`: HTTP 503、`server_error`、中英文 i18n。
- `routingCodeToErrorCode` 和多协议 encoder 能识别稳定码。
- `error-classify` 归类为 `phase=routing`、`category=service_unavailable`。
- Chat 四种入口保留各自 envelope；Image/TTS/STT 继续通过 `RoutingError` 和共享 mapper 返回相同稳定码。
- WebChat 仍可沿用现有面向用户的粗粒度 error event；Gateway 对外协议暴露稳定码。

不增加 `Retry-After`。仍在冷却的 Provider 有时间边界，但 `probe_busy` 的完成时间未知；返回猜测值会形成不可靠协议。

## 6. Observability

复用现有 Prometheus registry，新增一个低基数 counter：

```text
nekusora_gateway_circuit_breaker_events_total{event}
```

`event` 仅允许固定集合：`no_healthy_route`、`probe_acquired`、`probe_succeeded`、`probe_failed`、`probe_released`。禁止 Provider ID、route ID、模型名、请求 ID 或 Key 标签。

- Circuit breaker 记录探针生命周期事件。
- Routing/Engine 只在最终确认无健康候选时记录 `no_healthy_route`，同一执行不重复计数。
- 现有 `gateway_executions` final telemetry 记录稳定 `error_code`；无上游调用时不制造 attempt 行。
- 不新增 console 日志，不让原始 Provider Error 离开 Engine 安全边界。

指标写入保持 best effort，不能改变路由或执行结果。

## 7. Compatibility

- 这是有意的错误行为变更：全部熔断时从“重新尝试故障 Provider”改为明确 503。
- 正常 closed Provider、部分 Provider 熔断、route/key fallback、响应提交边界和 Provider timeout 分类保持现状。
- `recordSuccess()` / `recordFailure()` 继续保留给管理员手动 route probe；Gateway Engine 改用 permit port。
- 无数据库 schema、迁移、配置或依赖变更。

## 8. Validation

### Unit

- Circuit breaker：四种 availability、单 token、迟到/重复 release、中性释放、成功和失败终态、多 Provider 隔离。
- Routing：部分 open 时保留健康 Provider；全 open / probe busy 抛稳定错误且不返回全集。
- Engine：许可拒绝不调用 adapter；探针在成功、失败、timeout、Abort、确定性错误、adapter rejection、空 Key、Provider-start 失败后释放；竞争窗口返回稳定错误。
- Error/metrics：HTTP 503、i18n、分类、协议 envelope、低基数 label 和 metrics smoke。

### Integration

- Chat stream/generate：全熔断不触网；并发冷却只运行一个探针；有健康备用时继续 failover。
- Image/TTS/STT：稳定错误映射不被媒体通用 502 覆盖。

### Project gates

- Targeted Vitest suites and package typechecks.
- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm build:gateway`
- `git diff --check`

## 9. Rollout And Rollback

改动随应用发布生效，无数据迁移。回滚只需回退本任务代码提交；进程内 breaker 状态会随进程重启清空。若上线后 503 比例上升，应先通过新 counter 和 execution error code 判断是真实 Provider 不健康还是探针长期占用，不应恢复无界 fail-open。
