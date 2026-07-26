# MAGI 项目进化第 11 轮

## Goal

保证 Web 进程在 worker 尚未创建队列时也能可靠投递 pg-boss 任务，并让 `/healthz/ready` 在队列后端无法初始化时返回非就绪，避免标题、记忆和文件处理任务因生命周期竞态静默丢失。

## Background

- `src/lib/infra/queue.ts` 当前只在 worker 的 `work()` 前调用 `createQueue()`；Web 侧 `send()` 不启动 pg-boss、也不建队列。pg-boss 11.1.2 对不存在的队列会抛出 `Queue <name> does not exist`。
- `getQueue()` 没有 in-flight promise，首次并发调用可构造多个 PgBoss 实例；pg-boss 自身的并发 `start()` 后调用不会等待首次启动完成。
- `queueAvailable()` 只返回常量 `available: true`，readiness 又只根据 DB 检查决定 HTTP 200，因此队列未启动、连接失败或超时时仍可能误报 ready。
- 文件上传已有队列失败 fallback；标题和记忆任务保持异步 best-effort，当前记忆入队错误被完全吞掉。

## Requirements

- `getQueue()` 必须用单个 in-flight promise 合并并发首次构造；构造失败后清理状态，允许后续重试。
- QueueAdapter 必须统一拥有 pg-boss 生命周期：`start()` 的并发调用等待同一个启动 promise，失败后允许重试。
- `send(name, ...)` 与 `work(name, ...)` 在操作前必须先完成启动并幂等创建目标队列；同进程同名队列的并发创建只执行一次，失败后可重试。
- pg-boss 返回空 job id 时必须视为投递失败，不能伪装成成功。
- 保持既有调用方语义：上传投递失败继续走本地 fallback；标题与记忆入队不阻塞主聊天响应；记忆入队失败至少输出经过共享脱敏的错误日志。
- `queueAvailable()` 必须实际等待队列启动成功；初始化错误继续抛给 readiness 的现有超时/错误包装。
- readiness 仅在 DB 与 queue 检查都成功时返回 200；queue false、error 或 timeout 返回 503。storage/redis 仍为信息性检查，不改变当前必需性。
- readiness 的 queue 状态只表示队列后端可初始化/可投递，不声称检测独立 worker 的消费活性。
- 保持 pg-boss 变量路径动态 import，避免 Next Edge instrumentation 构建回归。

## Acceptance Criteria

- [x] 并发首次 `getQueue()` 只构造一个 PgBoss adapter，所有调用获得同一实例；首次构造失败后再次调用可成功。
- [x] 并发 `start()`/`send()` 等待同一个真实启动过程，不会在首次 start 完成前继续建队列或发送。
- [x] Web 进程可在 worker 未先启动时完成 `start -> createQueue -> send`；同名并发投递只建队列一次。
- [x] `start`、`createQueue` 或空 job id 失败均向调用方 reject，且失败的启动/建队状态可在下一次调用重试。
- [x] 上传 fallback 与聊天主响应行为不回归；标题/记忆失败不阻断主流程，记忆失败不再完全静默。
- [x] readiness 在 DB 和 queue 均正常时返回 200；queue false/reject/timeout 时返回 503 并保留现有 `checks.queue` 诊断结构。
- [x] 聚焦测试、lint、typecheck、全量测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 新增 outbox、持久化重试策略或 exactly-once 投递保证。
- 在聊天请求内同步执行标题生成或记忆抽取。
- 检测 worker 心跳、消费延迟或积压深度。
- 改变 storage/redis 对 readiness 的必需性。
- 修改 pg-boss schema 或 Drizzle migration。

## Risks And Deferred Items

- readiness 首次调用会启动 pg-boss，并可能安装/迁移其独立 schema；这是验证真实可投递性的必要副作用。
- queue backend 可用不等于 worker 在线；后续如需消费活性，应设计 worker heartbeat，而不是在本轮伪造判断。
- Web 进程在投递结果未知时仍无法提供 exactly-once；文件 fallback 的服务端已提交但客户端报错竞态沿用既有明确边界。
