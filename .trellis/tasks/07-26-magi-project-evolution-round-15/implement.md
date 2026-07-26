# Implementation Plan

1. 在 `stream-circuit-breaker.test.ts` 增加两路由回归测试：首路由先产出 `text-delta` 再报错，第二路由准备不同正文；运行单文件测试并确认修复前因第二路由被调用而失败。
2. 在 `streamChat` 请求级作用域增加响应提交状态，在 `text-delta`、`reasoning-delta` 和 `tool-call` 向外 `yield` 前置为 true。
3. 让 key 重试条件在响应未提交时才成立；让路由循环在完成既有可转移判定和 `recordFailure` 后，遇响应已提交直接停止。运行聚焦测试确认首个 tracer bullet 转绿。
4. 配置同 Provider 两个 key 的回归用例，断言首个尝试已输出后 `streamText` 只调用一次、后续 key 不调用且结果以 error 终止。
5. 扩展不可撤回事件覆盖，确认 reasoning/tool-call 后失败同样不会转移；保留未输出失败仍可容灾的现有行为。
6. 更新 `.trellis/spec/backend/gateway-routing.md`，在路由排序与熔断场景中补充流式响应提交后的故障转移边界、矩阵和测试要求。
7. 运行聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 和 `task.py validate`；核对日志、breaker、脱敏、Abort、Agent loop 与非流式路径未回归。
8. 使用两路只读子代理分别复核实现/状态机边界与测试防回归能力，主代理按精确 `file:line` 点验所有发现并修正阻塞项。

## Validation Commands

- `pnpm exec vitest run src/lib/stream-circuit-breaker.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-15`

## Risk And Rollback Points

- 提交状态必须在事件 `yield` 前设置，不能在恢复后设置，否则紧随事件的上游异常仍可能看到旧值。
- 已提交失败要同时禁止 key 和 route 两级重试；只拦一层仍会产生拼接。
- `recordFailure` 必须在“是否还有下一路由”判断前执行，不能用提前 `break` 跳过 breaker 更新。
- `logAttemptFailure` 和错误脱敏必须保持在现有 catch 路径，禁止容灾不等于省略失败审计。
- Abort 不得落入普通失败路径；若测试发现中止行为变化，回退本轮代码并重新定位条件顺序。
- 不修改部分 usage 计量。若实现必须改变日志 schema、事件协议或前端合并行为，应返回规划并拆分任务。

## Completion Gate

- 正文、推理或工具调用已输出后，后续 key 与 route 均未调用。
- 未输出时的既有容灾、熔断、日志和错误脱敏行为保持不变。
- 已输出失败仍记录 attempt failure、更新 breaker 并以 error 事件终止，不记录 success。
- 独立复核无阻塞项，全部自动化门禁通过。
