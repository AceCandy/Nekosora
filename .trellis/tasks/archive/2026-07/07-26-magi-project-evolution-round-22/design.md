# 会话标题持久投递设计

## Problem Statement

fallback 与 pg-boss job 当前是两个无协调的 PostgreSQL 写入。第一个成功、第二个失败或进程退出时，没有 durable 状态告诉任何后续进程仍需投递。第 21 轮只修复了“job 已存在但 handler 错误确认”，没有覆盖 producer 侧缺口。

## Invariants

1. 可见 fallback 与可恢复 job 状态一起提交或一起回滚。
2. outbox 行存在即表示标题工作尚未业务完成；队列 send 成功不等于完成。
3. 同一会话只有一个 current job id；旧消息不能执行或清理新 job。
4. dispatcher claim 使用数据库时间，任何进程退出都最多延迟下一次投递。
5. delivery 是 at-least-once，模型调用前与最终写入时都必须验证 current job。

## Components

- `conversation_title_jobs`：专用 outbox 和 current-job fencing 来源。
- `writeFallbackTitle(...) -> Promise<ConversationTitleJob | null>`：事务写 fallback + upsert job，返回带 job id 的完整 payload。
- `dispatchConversationTitleJob(jobId)`：原子 claim 到期行并发送 pg-boss；send 失败不删除。
- `recoverConversationTitleJobs()`：查询最多 25 个到期 id，稳定排序并顺序 dispatch，单项失败隔离。
- `startConversationTitleRecovery()`：立即 + 60 秒单飞调度，停止等待。
- `generateConversationTitle(job)`：先验证 current job，再生成；最终事务重新 fencing 并原子更新标题/清理 job，明确 no-op 只清理匹配 id，失败保留并 reject。

## Transaction And Fencing

fallback 更新与 outbox upsert 放在一个短 Drizzle transaction。只有 `title='新会话' AND conversation.user_id=:userId` 更新成功才写 outbox。

outbox 以 `conversation_id` 唯一，upsert 时替换主键 job id 与完整 payload。worker 查询必须同时匹配 job id、conversation id、user id；旧 job 无法命中时不调用模型。完成清理只 `DELETE WHERE id=:jobId`，不会删除后来替换的新 job。

模型调用可能跨越 job 替换，因此预检不是最终写权限。生成完成后进入短事务：最终标题 UPDATE 同时匹配默认标题/本轮 fallback，并用当前 outbox job id 的存在谓词重新 fencing；随后只删除同一 job id。任一步失败整体回滚。旧 job 即使通过预检、且新旧 fallback 恰好相同，也无法在被替换后写标题或删除新 outbox。

明确 no-op 在模型调用前即可清理：会话删除由 FK 级联；标题已变化时 `DELETE WHERE id=:jobId`。若清理前 job 已被替换，旧 id 删除零行，新 job 保留。

## Dispatch And Recovery

dispatcher 用单条 UPDATE claim：

```sql
UPDATE conversation_title_jobs
SET dispatch_after = now() + interval '15 minutes'
WHERE id = :job_id AND dispatch_after <= now()
RETURNING payload_columns;
```

send 前退出会留下未来 `dispatch_after`，15 分钟后恢复；send 后退出可能产生重复 job，但 fencing/no-op 保证安全。固定 15 分钟窗口与 pg-boss 自身两次有限 retry 组合，避免永久配置错误形成高频模型调用。

scanner 查询 `dispatch_after <= now()`，按 `dispatch_after, created_at` 排序，限制 25 条。查询失败交给 scheduler 记录脱敏错误并等待下一 tick；单 job send 失败记录 job id 后继续同批其他任务。

worker 同时拥有文件恢复和标题恢复。关闭按启动逆序停止两个 scheduler，再停止 queue；任一步失败仍继续清理并以非零码退出。启动注册失败则停止所有已启动 scheduler 和 queue，保留原错误。

## Compatibility And Rollout

- API/SSE/前端无变化；fallback 仍同步写，标题 dispatch 仍不阻断主回答。
- 迁移只新增空表，不回填旧 fallback，因为历史 fallback 与手动标题无法可靠区分。
- 部署顺序：迁移 → 新 Web/worker。旧 Web 不写 outbox，但不会破坏新表；滚动窗口内新请求只有命中新 Web 才获得持久投递，因此不宣称旧实例兼容补偿。
- 回滚代码可保留空/遗留 outbox 表；后续删除必须追加迁移。

## Verification Strategy

Vitest mock 测试覆盖服务分支、dispatcher claim/scanner/scheduler、route 接线与 worker 生命周期。迁移一致性测试覆盖 SQL/journal/snapshot。

核心 SQL 使用单条条件 UPDATE 和事务，不引入复杂锁协议；本轮不新增真实 PostgreSQL harness。残余风险是 mock 无法证明驱动事务隔离，但迁移形状、SQL 谓词与现有 PostgreSQL-only Drizzle 模式均由类型检查和代码复核验证。

## Risks

- 永久模型配置错误会每 15 分钟重投；频率有界但无管理界面。后续可基于实证增加 dead-letter/退避。
- 迁移前产生的历史 fallback 不可恢复，不做启发式回填以避免覆盖用户标题。
- 多 worker 会重复扫描候选，但 claim UPDATE 保证同一窗口只有一个 sender。
