# 实施计划

## 1. 失败先行测试与 schema

- 服务测试覆盖 fallback/outbox 同事务：更新未命中不写 job，upsert 失败回滚，成功返回完整 job id/payload。
- dispatcher 测试覆盖数据库时间 claim、未到期 no-op、send 失败保留、25 条稳定扫描、单项失败继续、scheduler 单飞/停止。
- 标题服务测试覆盖模型调用前与最终事务双重 fencing、成功/no-op 删除、模型失败保留；旧 job 不调用模型，生成期间被替换的 job 不写标题。
- worker/route 测试覆盖 immediate dispatch 与双 recovery 生命周期。
- 迁移测试断言 `0014` SQL、FK/unique/index、journal 和 snapshot 连续。

验证：新增行为测试在 schema/dispatcher 实现前失败，且失败点对应 PRD。

## 2. 追加 outbox schema 与迁移

- 在 `src/db/schema/pg.ts` 增加 `conversationTitleJobs` 表和 payload 类型引用。
- 使用 Drizzle 生成命名 `0014_conversation_title_outbox` 的 SQL/journal/snapshot，不改写历史迁移。
- 补迁移一致性测试并运行 schema 相关测试。

## 3. 原子创建、投递与业务完成

- 扩展 `ConversationTitleJob` 加 job id；`writeFallbackTitle` 在事务中更新 fallback 并按 conversation upsert outbox，返回完整 job。
- 新增 `src/lib/conversation-title/dispatch.ts`：原子 claim、queue send、到期扫描和单飞 scheduler。
- `generateConversationTitle` 先验证 current job；最终短事务再次验证 job id，并原子更新标题/删除 outbox；明确 no-op 只删除匹配 id，生成失败保持第 21 轮 rejection。
- route 用返回的 job id启动 immediate dispatch，继续脱敏记录失败且不阻断 Chat。

## 4. Worker 生命周期与规范

- worker 注册 handler 后启动标题 recovery；关闭与启动失败路径完整清理两个 scheduler 和 queue。
- 更新 `database-guidelines.md` 的 producer durability/at-least-once 契约，并在需要时补标题领域说明。
- 独立只读复核投递窗口、旧 job fencing、用户改名、事务与 worker 清理。

## 5. 完整门禁

```bash
pnpm vitest run src/lib/conversation-title/service.test.ts src/lib/conversation-title/dispatch.test.ts src/lib/conversation-title/outbox-migration.test.ts src/worker.test.ts src/app/api/chat/route.test.ts src/lib/infra/queue.test.ts
pnpm check
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-22
git diff --check
```

本轮不启动服务、不访问真实上游、不修改 Mem0 数据。完成后提交、归档并进入下一轮。
