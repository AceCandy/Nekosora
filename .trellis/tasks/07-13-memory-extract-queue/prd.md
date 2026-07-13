# 记忆提取搬入 pg-boss 队列

## Goal

将 `extractMemories` 从 `/api/chat` 收尾的同进程 fire-and-forget,改为入队 pg-boss 由 worker 消费。**抗进程重启、释放主进程 event loop**,复用现有 pg-boss,不引入新中间件。

## Background

`src/app/api/chat/route.ts:346` 当前 `extractMemories(...).catch(() => {})`:
- HMR / 部署重启时,进行中的提取任务丢失;
- 占用 Next.js 主进程 event loop,与活跃 chat 请求抢资源。

`extractMemories`(`src/lib/memory/extract.ts`)入参全可序列化(`userId` / `conversationId` / `recentMessages` / `model`),内部仅依赖 DB + LLM + embedding + cache,**不依赖请求对象/SSE 上下文**,天然适合入队。

## Requirements

- `/api/chat` 收尾副作用改为入队 `memory-extract` job,不阻塞响应
- `src/worker.ts` 增加 `memory-extract` handler,调用 `extractMemories`
- `extractMemories` 内部逻辑不变(LLM 提取 / 频率保护 / 向量去重 / 缓存失效)
- 保留"失败静默、不阻断主对话"语义
- 10 分钟/用户频率保护**跨进程仍生效**

## Constraints

- job data 仅含可序列化字段(不得传函数 / 请求对象 / 不可序列化的上下文)
- 不改变记忆提取的触发时机(仍在对话流结束后)与结果
- 复用 pg-boss,不引入 BullMQ / Redis 队列
- worker 中 `memory-extract` 与 `file-process` 共存,单 job 失败不得拖垮 worker 进程或影响其他 job
- `extractMemories` 的 cache 频率保护跨进程语义需在 design 明确处理(worker 是独立进程,内存 cache 与主进程不共享)

## Acceptance Criteria

- [ ] 发起对话后 `memory-extract` job 入队(pgboss 表可见记录)
- [ ] worker 消费 job,记忆正确写入 `user_memories`(端到端验证)
- [ ] `/api/chat` 收尾不再在主进程直接调 LLM 做记忆提取(释放)
- [ ] 10 分钟频率保护跨进程生效(连续多次对话不重复提取)
- [ ] worker 重启后,已入队未消费的 job 仍被消费(pg-boss 持久化)
- [ ] 单个 `memory-extract` job 失败不影响其他 job 与 `file-process`
- [ ] `pnpm typecheck` / `pnpm lint` 通过

## Notes

- 复杂任务,需 `design.md` 明确 job data 契约 / 入队点改造 / handler 注册 / **频率保护跨进程方案** / 与 file-process 共存的隔离,`implement.md` 给执行清单。
- 频率保护跨进程是本任务最微妙点:配 Redis 时 cache 天然共享;不配时 worker 进程内 cache 需配合主进程入队前预检,design 须给出明确方案。
