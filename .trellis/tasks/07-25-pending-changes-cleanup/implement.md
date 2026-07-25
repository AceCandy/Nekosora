# Implement: 未提交改动收尾

## 1. Batch A - 反馈与分支恢复

1. 对照 `0008_model_catalog_configured.sql` 修正 0008 snapshot 基线，并确认该 SQL 的工作树 diff 为空。
2. 使用项目 Drizzle 工具生成 `0009_*` feedback SQL、journal 与 snapshot，删除重号文件；断言 journal idx 连续、0009 `prevId` 指向 0008 `id`。
3. 复核 feedback action 鉴权、branch DTO、store 回滚和 UI/i18n 接线。
4. 运行：

```bash
git diff --exit-code HEAD -- drizzle/pg/0008_model_catalog_configured.sql
pnpm db:generate:pg
node - <<'NODE'
const fs = require("node:fs");
const dir = "drizzle/pg/meta";
const journal = JSON.parse(fs.readFileSync(`${dir}/_journal.json`, "utf8"));
const last = journal.entries.at(-1);
if (last.idx !== 9 || !last.tag.startsWith("0009_")) throw new Error("invalid 0009 journal entry");
const prev = JSON.parse(fs.readFileSync(`${dir}/0008_snapshot.json`, "utf8"));
const next = JSON.parse(fs.readFileSync(`${dir}/0009_snapshot.json`, "utf8"));
if (next.prevId !== prev.id) throw new Error("broken snapshot chain");
NODE
pnpm exec vitest run \
  src/features/chat/actions/feedback.test.ts \
  src/features/chat/model/feedback.test.ts \
  src/features/chat/actions/branch.test.ts \
  src/features/chat/store/chatStreamStore.test.ts
```

## 2. Batch B - 上下文预算与压缩

1. 修复小 context window 的 input/output 预算夹取；新增 `contextWindow=1024` 用例，断言 `inputBudget <= 1024` 且输出预算至少为 1。
2. 修复非字符串 system 消息被删除；用数组/对象 content 断言该 system 消息仍保留在 dialogue。
3. 复核 `branchLeafPublicId`、compact、token trim 与 model catalog 数据流。
4. 运行：

```bash
pnpm exec vitest run \
  src/lib/chat/orchestrator.test.ts \
  src/lib/context-assembler.test.ts \
  src/lib/compact/service.test.ts \
  src/lib/tokens.test.ts
```

## 3. Batch C - Agent 用量聚合

1. 增加 Agent fallback 终态构造：无 step usage 时从外层 opts 取 run/user/model/source/taskKind，token=0、路由/TTFT 留空；零步骤为 interrupted，捕获异常为 failed。
2. 补 `maxSteps=0`、首步回调前异常、失败 attempt、metrics 唯一性、TTFT/终轮路由快照测试，并断言每条链路只调用一次最终 `logUsage`。
3. 复核 logging spec 与实现一致。
4. 运行：

```bash
pnpm exec vitest run src/lib/stream-agent-loop.test.ts src/lib/stream.test.ts
```

## 4. 全量门禁与提交

1. `pnpm check`
2. `pnpm test`
3. `git diff --check`
4. 逐批精确暂存并运行 `git diff --cached --check`、独立 staged review。
5. 建议提交顺序：
   - `feat(chat): 完善消息反馈与分支状态恢复`
   - `feat(chat): 完善分支上下文预算与压缩`
   - `fix(chat): 聚合 Agent 多轮用量日志`
6. 归档任务、记录 journal、推送并验证 `HEAD == origin/main`。

## 5. 回滚点

- Batch A：回退前端/action；数据库表保留，不做破坏性 drop。
- Batch B：仅回退 route 的 branchLeaf hunk和上下文模块。
- Batch C：回退聚合开关和外层日志逻辑，恢复每步原有行为。
