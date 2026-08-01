# Bug Analysis: Chat execution telemetry 未收敛

## 1. Root Cause Category

- **Category**: B/D - 跨层契约 + 测试覆盖缺口。
- **Specific Cause**: `executeChatCompletion` 在消费 `finish/error` 后关闭外层 async iterator；`streamChat` 的最终 usage 逻辑位于 generator `finally` 之后，且嵌套 `executeGateway` 没有在消费者关闭时被推进/关闭。于是 Chat completion 可以成功提交，但 `gateway_executions` 仍停在 `running`，成功过滤的用量页看不到它。

## 2. Why Fixes Failed

1. 原先的 `closeIterator` 只调用 `iterator.return()`，解决了 Chat 协调器不等待 provider 的问题，却跳过了流尾部的 telemetry 回调。
2. 只把收尾逻辑移动到 `streamChat` 的 `finally` 仍不足以覆盖 Abort：engine 可能挂在 adapter `next()`，所以 engine 需要直接竞速 Abort 并在 active attempt 上补 interrupted 事实。
3. 只修改用量查询条件会把未收敛的运行状态伪装成可见用量，不能修复数据生命周期，因此明确保留 success-only 查询。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 具体动作 | 状态 |
|---|---|---|---|
| P0 | 架构 | terminal consumer 推进一次内层 iterator；engine 对 adapter `next()` 竞速 Abort；stream `finally` 非阻塞请求 nested close | DONE |
| P0 | 文档 | 将 async stream terminal/cleanup 边界写入 Chat、logging 与 cross-layer 规格 | DONE |
| P0 | 测试 | 覆盖 finish/error settlement、自然 usage、callback 异常、Abort-ignoring adapter、active attempt finalization | DONE |
| P1 | 运行监控 | 继续监测 `gateway_executions.status='running'` 的年龄分布，发现新请求异常增长 | TODO |

## 4. Systematic Expansion

- **Similar Issues**: 任何手动消费嵌套 async generator 的 image/audio/副任务入口，都应检查终态事件与 generator cleanup 是否分离；本次 engine 修复已覆盖共用 execution 入口。
- **Design Improvement**: 将 execution finalization 作为 engine 的唯一责任，调用方只能消费事件，不再通过查询层补偿生命周期错误。
- **Process Improvement**: 跨层流改动必须同时验证自然完成、terminal 后 settlement、Abort 和 consumer `return()`；不能只跑单层 coordinator mock。

## 5. Knowledge Capture

- [x] `.trellis/spec/backend/chat-run-metadata.md`
- [x] `.trellis/spec/backend/logging-guidelines.md`
- [x] `.trellis/spec/guides/cross-layer-thinking-guide.md`
- [x] 任务 PRD、设计、实施清单与 context manifests
