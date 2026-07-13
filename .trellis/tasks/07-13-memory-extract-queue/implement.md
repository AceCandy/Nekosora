# Implement:记忆提取搬入 pg-boss 队列

## 执行清单

1. **route.ts 改入队**:
   - import `getQueue` from `@/lib/infra/queue`
   - 把 `route.ts:343-346` 的 `extractMemories(...).catch(() => {})` 改为 `getQueue().then(q => q.send("memory-extract", {...})).catch(() => {})`
   - 保留 `recentMessages` 构造逻辑与 `if (assistantText && !isContinue)` 守卫不变
   - 移除 route.ts 对 `extractMemories` 的 import(改为 worker 侧用),保留其余 import
2. **worker.ts 加 handler**:
   - import `extractMemories` from `@/lib/memory/extract`
   - 在 `file-process` handler 之后注册 `memory-extract` handler(按 design 契约)
3. **自检**:
   - job data 字段与 extractMemories 入参一一对应
   - route.ts 不再 `await` 入队(保持 fire-and-forget)
   - worker 两个 handler 共存,`shutdown` 优雅关闭仍覆盖两者(`queue.stop()`)

## 验证

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 通过
- [ ] 端到端:启动 `pnpm dev` + `pnpm worker`,发起一轮对话 →
   - pgboss 表出现 `memory-extract` job 记录
   - worker 日志打印 `[worker] memory-extract: <userId>`
   - 对话内容含可提取偏好时,`user_memories` 表出现新行
- [ ] 频率保护:10 分钟内连续多轮对话,worker 仅真正提取一次(后续 job 命中 cache 跳过)
- [ ] 抗重启:入队后立即重启 worker,job 仍被消费(pg-boss 持久化)
- [ ] 隔离:`memory-extract` job 故意失败(如临时改坏 prompt)不影响 `file-process` 消费

## 回滚点

- route.ts 与 worker.ts 两处改动,git revert 该提交即恢复同进程 fire-and-forget。
- 已入队但未消费的 job 在 pgboss 表中,回滚后不会被消费(无 handler),可手动清理或等归档。
