# 实施计划

## 1. 建立失败先行测试

- 扩展 `src/lib/conversation-title/service.test.ts`：模拟 `generateChat` 抛出包含敏感占位文本的异常，断言服务以固定通用文案 reject、fallback 不变且错误不包含原始文本。
- 覆盖 `generateChat` 返回 error、空文本和清洗后空文本，断言这些生成失败不再返回 `null`。
- 保留成功生成及用户改名 no-op 测试，并验证兼容入口仍静默保留 fallback。
- 扩展 `src/worker.test.ts`：捕获注册的标题 handler，模拟标题服务 reject，断言 handler 保持 reject。
- 扩展 `src/lib/infra/queue.test.ts`：执行 `mocks.work` 收到的 pg-boss callback，模拟业务 handler reject，断言 callback 原样 reject 且不处理后续 job。

验证：先运行标题服务、worker 和 queue adapter 测试，确认新增服务断言在实现前因错误被吞掉而失败。

## 2. 实现最小失败分类

- 在 `src/lib/conversation-title/service.ts` 增加私有通用标题生成错误。
- 把 `generateChat` thrown、error result、无文本和清洗后空文本转换为该错误；不保存原始异常或 cause。
- 保留输入/会话/标题条件 no-op 的 `null` 和成功条件更新。
- 让 `maybeGenerateTitle` 只捕获新增错误，其他异常继续传播。

验证：运行标题服务、worker 和 queue adapter 测试，确认红灯转绿；再运行 Chat route 回归测试。

## 3. 独立复核与规范沉淀

- 派只读探子复核失败分类、兼容行为、敏感信息边界和测试缺口，主代理按 `file:line` 点验。
- 更新 `.trellis/spec/backend/database-guidelines.md` 的 pg-boss worker 契约：明确 handler 只有成功或业务 no-op 才能 resolve，可恢复失败必须 reject，且队列错误不得携带敏感详情。
- 检查 diff 只覆盖本轮任务与必要规范，不触碰未识别的 round-19 目录。

## 4. 完整质量门禁

验证命令：

```bash
pnpm vitest run src/lib/conversation-title/service.test.ts src/worker.test.ts src/lib/infra/queue.test.ts src/app/api/chat/route.test.ts
pnpm check
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-26-magi-project-evolution-round-21
git diff --check
```

本轮不启动服务、不访问真实上游、不修改数据库，因此不执行浏览器或 PostgreSQL harness。完成门禁后提交实现与任务产物，归档第 21 轮并进入下一轮。
