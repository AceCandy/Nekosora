# MAGI 项目进化第 22 轮

## Goal

修复首条消息 fallback 已持久化、但 Web 进程在标题任务写入 pg-boss 前退出或队列暂时不可用时任务永久丢失的问题，使标题任务最终可投递、可重试且不会覆盖用户手动标题。

## Background

- 第 21 轮已让已入队标题任务的生成失败正确 reject，恢复 pg-boss 有限重试。
- Chat 当前在 fallback 更新后以 fire-and-forget 调用 `getQueue().send`；send 失败只记日志，进程退出时 Promise 甚至可能未完成（`src/app/api/chat/route.ts:260-279`）。
- fallback 已在业务表提交，pg-boss job 尚未持久化，两个独立写入之间没有恢复状态。
- 标题处理已有 `conversationId + userId + 当前标题` 条件写，重复执行不会覆盖手动标题；第 21 轮又明确区分了成功/no-op 与可重试失败。

## Requirements

- 新增专用 `conversation_title_jobs` 持久 outbox；fallback 标题更新与当前会话 job upsert 必须在同一个数据库事务中提交。
- 每个 job 必须有随机 job id。相同会话的新 job 替换旧 outbox 行；旧队列消息不得执行或清理新 job。
- outbox 保存生成所需的首条消息、fallback、chat model/name/id 和下一次允许投递的数据库时间；不得保存密钥或完整请求对象。
- dispatcher 必须用单条条件 UPDATE 原子 claim 到期 job，并把下次投递时间推迟固定窗口；未 claim 到时 no-op。
- claim 后队列 send 成功、失败或进程退出都必须可恢复：失败不删除 outbox；周期扫描在窗口到期后重投。
- worker 启动后必须立即并每 60 秒扫描到期 job，单飞、顺序处理、单轮最多 25 条；关闭时停止 timer 并等待在途扫描，再停止 queue。
- worker 执行前和最终写入时必须确认 job id 仍是该会话当前 outbox；最终标题更新与匹配 outbox 删除必须在同一事务中完成。成功或明确 no-op 后只删除匹配 job id 的行，生成/数据库失败保留行并 reject。
- 重复队列消息必须幂等：已完成、用户改名、会话删除或已被新 job 替换时不得调用模型或覆盖状态。
- 队列/扫描日志必须脱敏，不包含消息正文、provider secret 或连接串。
- PostgreSQL 迁移必须追加，包含 SQL、Drizzle journal/snapshot 和迁移一致性测试。
- 不改变 Chat 主回答、fallback 文案、标题模型选择、pg-boss retry 参数或前端协议。
- 不修改 `memory-extract`；Mem0 公开 API 没有幂等键，不能套用本轮重试策略。
- 不扫描 `docs/cankao`，不升级 Trellis，不触碰未识别 round-19 目录。

## Acceptance Criteria

- [ ] fallback 更新失败时不创建 outbox；outbox insert/upsert 失败时 fallback 事务回滚。
- [ ] fallback 与 outbox 成功后，即使立即 dispatch 失败或进程不再执行异步回调，周期扫描仍能投递同一 job。
- [ ] 并发 dispatcher 对同一到期 job 只有一个 claim 成功；未到期 job 不发送。
- [ ] send 失败保留 outbox，窗口到期后可再次 claim；send 成功但进程在完成前退出也可重投。
- [ ] 当前 job 成功或用户改名 no-op 后被清除；生成失败保留并 reject。
- [ ] 旧 job id 不能调用模型、删除新 outbox 或覆盖新标题；即使在模型调用期间被替换且 fallback 相同，最终事务也必须拒绝旧 job 写入。
- [ ] scanner 启动立即运行、周期单飞、限制 25 条，单 job 失败不阻断后续，停止等待在途扫描。
- [ ] worker 启停清理同时覆盖文件恢复和标题投递恢复。
- [ ] `0014` 迁移、journal、snapshot 与 schema 一致性测试通过。
- [ ] 标题服务、dispatcher、worker、Chat route 和 queue 回归测试通过。
- [ ] `pnpm check`、全量测试、生产构建、Trellis validate 与 `git diff --check` 全部通过。

## Out Of Scope

- 通用 outbox 框架、管理界面、死信队列或人工重试入口。
- 记忆抽取、文件处理和其他后台任务的投递语义。
- 修改 pg-boss 默认 retry、expire、backoff 或 dead-letter 配置。
- 跨服务 exactly-once；本轮提供 durable at-least-once + 业务幂等。
