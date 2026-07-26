# Verification Evidence

## Behavioral Checks

- 并发冷启动只构造一个 adapter；构造、start 和 createQueue 失败后均可重试。
- send/work 统一等待 start 与同名 createQueue；`null`/空字符串 job id 明确 reject。
- stop 期间的新 send 等待停止完成后重新启动；stop 也等待已经进入 create/send/work 的活动操作完成。
- 上传队列异常仍触发一次本地 fallback 并保持既有成功响应。
- 记忆任务入队仍为 fire-and-forget，失败改为输出经过共享脱敏的日志。
- readiness 仅在 DB 与 queue 都成功时返回 200；queue false、error 和 timeout 均返回 503，响应字段形状不变。

## Independent Review

- 生命周期、producer、readiness、pg-boss 11.1.2 源码语义和测试 seam 分五路完成初始研究。
- 三路实现复核检查并发、运维/API 兼容和验收覆盖；发现并修复 stop/start 竞态。
- 最终 operation barrier 复核未发现可触发的阻塞、穿透、错误 promise 清理或不必要串行问题。

## Automated Gates

- 聚焦测试：3 个文件，36 项测试通过。
- 全量测试：65 个文件，620 项测试通过。
- `pnpm lint`：通过，无警告或错误。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，变量动态 import 未造成 Edge instrumentation 构建回归。
- `git diff --check`：通过。

## Not Verified

- 未连接真实 PostgreSQL/pg-boss 执行 schema 初始化、建队、发送或消费；第三方行为由锁定版本源码和 mock 单测验证。
- 未启动 Web/worker 进程发送真实 SIGTERM；停止交错由可控 Promise 时序测试验证。
- readiness 不检测独立 worker 心跳、消费延迟或积压，queue ready 仅表示当前进程可初始化队列后端。
- 未新增标题/记忆端到端 route 测试；其 fire-and-forget 与日志行为由静态调用链复核，主聊天生成测试由全量套件覆盖。
