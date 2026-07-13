# 聊天链路性能与队列化优化

## Goal

治理聊天链路三个真瓶颈,提升用户量增长后的首字延迟与请求进程可用性。parent 负责整体目标与集成验收,具体实现下沉到 child 子任务,**本身不做实现**。

## Background

经架构分析(见会话讨论),用户量增长后的真实瓶颈**不在队列中间件**,而在:
1. DB 连接池 `max:10` 过小,段A密集查询 + 段C落库 + 队列共用 PG,并发 10+ 请求即排队等连接;
2. `/api/chat` 段A(`prepareChatContext`)串行 await 耗时步(联网搜索/记忆召回/压缩),首字延迟累加;
3. 记忆提取 `extractMemories` 是同进程 fire-and-forget,HMR/部署重启会丢失进行中的任务,且与活跃请求抢 event loop。

结论:**不做 Redis 双后端队列**(YAGNI),而是治这三个真瓶颈。队列存储保持 pg-boss(已够用),扩展其消费面。

## Scope

**IN**:
- child `db-pool-tuning` —— 应用层调大 Pool max 并 env 化
- child `chat-context-parallel` —— 段A无依赖耗时步并行化
- child `memory-extract-queue` —— 记忆提取搬入 pg-boss 队列

**OUT**(明确排除,延后或独立评估):
- pgbouncer —— 部署架构改动 + session 级兼容性风险,独立运维任务
- 图片生成入队 —— 需改前端轮询交互,回归面大,独立后续任务
- Redis 队列双后端 / BullMQ —— 当前负载下 pg-boss 足够

## Requirements

- 三个 child 各自独立交付、独立验证、独立归档
- 不改变现有对外行为:chat 流式回复、记忆写入、RAG 检索结果、联网搜索、压缩、artifact 抽取均与改动前一致
- 不引入新中间件
- 每个改动可独立回滚

## Cross-child Acceptance Criteria

- [ ] 三个 child 均完成并各自通过验收
- [ ] 集成后 `/api/chat` 首字延迟不升高(段A并行 + 主进程释放记忆提取 → 应下降)
- [ ] 集成后 chat 主流程回归通过:流式生成 / 记忆写入 / RAG / 联网搜索 / 压缩 / artifact / 标题生成 均正常
- [ ] worker 进程正常消费 `file-process` + `memory-extract` 两类 job,互不干扰
- [ ] DB 连接池在并发下不再成为首选瓶颈(max 已按预算调大)
- [ ] 无新中间件依赖,`pnpm typecheck` / `pnpm lint` 通过

## Notes

- parent 不做实现,只在三个 child 完成后做集成验收。
- 集成验收方式:启动 `pnpm dev` + `pnpm worker`,跑完整对话链路(普通对话 / 带附件 RAG / 联网搜索 / 多轮触发记忆),确认无回归。
- 三个 child 之间无执行依赖,实现顺序按收益/风险:db-pool(最小) → chat-context-parallel(纯代码) → memory-extract-queue(跨进程)。
