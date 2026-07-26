# Implementation Plan

1. 在 lifecycle 测试中加入租约红灯：start 必须写 fresh lease，heartbeat 必须只更新当前 running run，DB 失败不得抛。
2. 在 `runs` schema 增加 `leaseExpiresAt` 与 `runs_active_conversation_idx`；实现数据库时间租约表达式和 `heartbeatRun`，保持 start/finalize best-effort。
3. 为会话 actions 添加活动 run SQL helper 和真值表/查询结构测试；把列表和轻量轮询都切换为 fresh running run 派生值。
4. 在 route 测试添加 finalize 延迟 tracer，证明 `[DONE]` 不早于 run 终结；再移除三处直接 `generating` 写入、接入 30 秒心跳、所有出口 clear timer，并调整完成时序。
5. 删除 bootstrap 的全量 generating 清理调用与函数，确保新实例启动不再修改其他实例的活动状态。
6. 使用 `pnpm db:generate:pg -- --name=add_run_lease` 生成 `0012` schema diff、journal/snapshot，再用 `apply_patch` 补数据库默认租约和旧 running NULL 行的两分钟兼容租约；不得全表重置遗留 bool，也不得修改旧迁移。
7. 增加迁移元数据测试，覆盖租约列与数据库默认值、部分索引、兼容 UPDATE、journal 递增和 snapshot prevId/schema。
8. 更新 `.trellis/spec/backend/logging-guidelines.md`、`chat-message-references.md` 与数据库契约，执行 break-loop 根因分析。
9. 使用两路默认只读子代理分别复核并发/时序与迁移/测试/规范，主代理只按 `file:line` 点验阻塞项并修正。
10. 运行聚焦测试、lint、typecheck、全量测试、生产构建、`git diff --check` 和 task validate；提交、归档、记录 journal，并自动创建第 19 轮。

## Validation Commands

- `pnpm exec vitest run src/lib/chat/run-lifecycle.test.ts src/features/chat/actions/conversations.test.ts src/app/api/chat/route.test.ts src/lib/chat/run-lease-migration.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-18`

## Risk And Rollback Points

- UI 的活动定义必须同时检查 `status='running'` 与 `lease_expires_at > now()`；只检查 status 会重新引入僵尸状态。
- 租约创建、续约和查询必须统一使用 PostgreSQL 时间，不能混用应用 `Date.now()`。
- 心跳 timer 必须 `unref` 且在最外层 finally 清除，避免请求结束后泄漏。
- `[DONE]` 必须在 await `finalizeRun` 之后；run 写仍 best-effort，不把审计库短暂失败扩大为模型流失败。
- actions 的两个入口必须复用同一活动 SQL，不能各自维护条件。
- `0012` 只能追加；snapshot prevId 必须指向 `0011`，journal idx/tag/when 严格递增。
- 若实现需要 SSE 恢复、run 接管或删除 legacy 列，应返回规划并拆分到后续轮次。

## Completion Gate

- 并发完成、最后完成、过期租约、心跳与 `[DONE]` 顺序均有失败先行的回归测试。
- 新旧 runtime 不再读写 `conversations.generating`；新实例启动不全量清状态。
- PostgreSQL 迁移与元数据完整，独立复核无阻塞项。
- 所有自动化门禁通过，未启动遗留服务或生成未跟踪临时文件。
