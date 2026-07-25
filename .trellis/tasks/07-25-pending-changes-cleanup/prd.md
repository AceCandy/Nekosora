# 未提交改动收尾

## Goal

将工作树中已实现但尚未提交的聊天功能整理为三个边界清晰、可独立验证和回滚的提交，修复审查发现的阻塞问题，归档任务并推送 `origin/main`。不扩大现有功能范围。

## Background

- 当前没有其他 active Trellis task，但工作树保留了消息反馈/分支恢复、上下文预算/压缩和 Agent 多轮用量聚合三组改动。
- 已确认未跟踪文件中没有密钥、临时调试产物或应忽略的构建文件。
- `drizzle/pg/0008_sticky_star_brand.sql` 与已提交迁移同号且未登记 journal，当前不可提交。
- 上下文链路存在两个边界缺陷：小 context window 可能得到超窗输入预算；非字符串首个 system 消息可能被静默删除。
- Agent 聚合链路在 `maxSteps=0` 时不会写入 `interrupted` 终态日志。

## Requirements

1. 消息反馈与分支恢复形成完整闭环：schema/迁移、Server Action 鉴权与 upsert、DTO 回填、store 乐观更新与回滚、版本切换字段保留、UI 和 i18n 一起提交。
2. 修复 Drizzle 迁移序号冲突；SQL、`meta/_journal.json` 和 snapshot 必须形成一致迁移链，不能修改已发布迁移的运行语义。
3. 上下文预算/压缩提交包含 `branchLeafPublicId` 接线、分支链构建、动态模型预算、token trim 和 compact，并修复小窗口预算与非字符串 system 消息丢失。
4. Agent 多轮用量提交只在外层写一条终态日志，保留步骤级 attempt 日志；补齐 `maxSteps=0`、失败链/指标唯一性和聚合元数据测试。
5. 三批提交不得混入彼此不相关的 hunk；既有远端提交不得 amend 或回滚。
6. 不提交 `.env*`、`.next`、`node_modules`、`.codegraph` 日志或其他本地产物。
7. 提交前执行针对性测试、`pnpm check`、`pnpm test` 与 `git diff --check`；完成后归档任务、记录 journal 并推送 `origin/main`。

## Acceptance Criteria

- [x] feedback 迁移无重号，journal/snapshot/SQL 一致，消息反馈与分支状态相关测试通过。
- [x] `contextWindow=1024` 时 `inputBudget <= 1024` 且输出预算至少为 1；数组/对象形式的首个 system content 仍留在 dialogue，新增回归测试通过。
- [x] `maxSteps=0` 及首步回调前异常均产生唯一正确终态日志；fallback 为零 token、保留请求/run 元数据且不伪造路由，attempt 日志和 metrics 边界有测试。
- [x] 三个 staged diff 均只包含对应文件/hunk，`git diff --cached --check` 通过。
- [x] `pnpm check`、全量 Vitest、`git diff --check` 全部通过。
- [ ] 三个工作提交、任务归档和 journal 提交均推送，`HEAD == origin/main`。
- [ ] 本任务完成后无属于这三组功能的未提交文件；其他外部并行改动如出现则保留并报告。

## Out Of Scope

- 不实现可恢复 SSE / 请求幂等 P2-B。
- 不新增反馈产品能力或重做聊天 UI。
- 不修改模型目录和已经推送的 model catalog 数据。
- 不执行破坏性数据库回滚。
