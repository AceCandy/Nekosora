# Implementation Plan

1. 为共享 bounded-wait helper 写 fake-timer 红灯，覆盖快速完成、timeout、timer 清理与 late rejection。
2. 实现 5 秒 best-effort wait helper，timer 支持时 `unref()`，不伪造底层取消。
3. 扩展 run lifecycle 测试：pending start/finalize/tool 写在预算后释放；再用内部执行器接入这些调用，heartbeat 保留真实 in-flight Promise。
4. 扩展 usage 测试：pending getDb/insert 不再阻塞调用方；将现有实现下沉并在导出入口统一有界等待。
5. 扩展 route 测试：unresolved heartbeat 单飞、完成后恢复、request abort/cancel 立即停止，以及失败 fallback update pending 后有界进入 finalize；实现共享 `stopHeartbeat`、in-flight guard 与 fallback bounded wait。
6. 更新 logging、database、chat 收尾和跨层规范，记录“等待超时不等于查询取消”及必要持久化边界。
7. 使用两路默认只读子代理分别复核运行时/定时器与 helper/usage/测试，主代理按 `file:line` 点验并修正。
8. 运行聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 和 task validate；提交、归档、记录 journal，并自动进入第 20 轮。

## Validation Commands

- `pnpm exec vitest run src/lib/best-effort.test.ts src/lib/chat/run-lifecycle.test.ts src/lib/usage.test.ts src/app/api/chat/route.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-19`

## Risk And Rollback Points

- timeout helper 必须包住 `getDb()` 本身，而非只包 insert/update，否则连接初始化仍可永久 pending。
- route fallback 必须包住完整 update factory；成功路径的必要消息事务与 conversation update 不得套用 best-effort timeout。
- timeout 后不得再次 await 底层 Promise；也不得把 late reject 暴露成 unhandled rejection。
- heartbeat single-flight 必须以原始 `heartbeatRun` Promise 为准，不能以 5 秒 wrapper 的完成代表底层完成。
- abort 与 cancel 都必须先停止 timer；stream start 已 abort 时不得建 timer；finally 重复停止必须幂等且不得清空未完成 heartbeat 的真实 guard。
- `[DONE]` 仍需等待必要消息持久化和 bounded finalize；不能因本轮目标改成提前发送。
- `logUsage` 的表分流、字段脱敏、metrics 与 `skipMetrics` 语义不得顺带重构。

## Completion Gate

- 挂起的 best-effort 审计/用量写入均能在固定预算后释放调用方。
- heartbeat 不重叠，abort/cancel 后不再调度，正常租约续期不回归。
- 所有超时日志保持脱敏，SSE/DB schema/必要消息持久化行为不变。
- 完整自动化门禁与两路独立复核通过，未启动遗留服务或生成未跟踪调试产物。
