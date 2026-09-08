# 执行计划

- [x] 用户确认本批规划后执行 `task.py start`；开始时检查新出现的用户改动。
- [x] 读取具体改动代码及前后端适用规范，记录 `pnpm check` / 测试基线。
- [x] 给现有数据库工厂补生命周期与类型回归，不连接真实数据库。
- [x] 恢复数据库入口、Schema 与 Pool 的真实类型，保留动态 import 和运行时语义。
- [x] 修复直接受影响调用方；优先类型推断，保持查询和事务语义，禁止以新类型豁免清零。
- [x] 运行各包 typecheck 与受影响契约测试；对照最终 diff 核验 SQL、字段、鉴权和锁顺序未改变。
- [x] 同步 `.trellis/spec/backend/database-guidelines.md` 的入口类型、目录位置和测试约定。
- [x] 运行根目录 `pnpm check`、`pnpm test`、`git diff --check`，独立复核并记录剩余风险。
- [ ] 展示提交计划，用户确认后再提交，不推送。

## 预期文件范围

- 根因：`packages/db/src/index.ts`。
- 事务与 SQL 类型：`packages/core/src/lib/conversation-title/service.ts`、`rag/processing-repository.ts`、`usage-aggregate.ts`（后两者同属 `packages/core/src/lib/`）；`apps/web/src/features/chat/actions/branch.ts`；`apps/web/scripts/backfill-web-search-keys.ts`。
- 查询类型擦除：`packages/core/src/lib/keys.ts`、`packages/core/src/lib/instruction-cards/service.ts`；`apps/web/src/features/chat/actions/conversations.ts`；`apps/web/src/app/(dash)/panel/actions.ts` 的绑定查询及必要时 `panel/keys/page.tsx` 的结果适配。
- 分享接口：`apps/web/src/features/chat/lib/share-rate-limit.ts` 及对应测试；`actions/share.ts` 的调用边界仅在确有需要时调整。
- 回归：新增 Core `src/lib/infra/db/index.test.ts`；上述改动直接触发的现有测试夹具。
- 规范：数据库指南；若发现前端类型指南直接描述同一失效契约，仅同步该条。

## 规划期只读验证

用 TypeScript CompilerHost 在内存中替换 `AnyDb` / `AnySchema`，不修改或输出产品源码。
Core 在包工作目录下预检为 8 条源码诊断，Web 链为 15 条；Gateway 7 条、Worker 4 条，均为已定位 Core 诊断的子集。
该预检用于估算传播范围，不代表拟议修复已经通过类型检查或运行时验证。

## 实施与复核结果（2026-09-08，待提交）

- 数据库入口恢复真实类型；直接调用方改用事务推断、SQL 类型与实际 Schema，未修改 SQL、表结构、字段、鉴权、锁顺序或连接生命周期。
- 新增工厂测试 8 项，修改入口前运行时测试先通过；类型断言由 Core `src/**/*.ts` 常规 typecheck 覆盖。
- `pnpm check` 通过（零警告）；`pnpm test` 通过：1845 passed、42 skipped，无新增跳过；`git diff --check` 通过。
- 实现后独立复核产品 diff 与测试：新增引用为 type-only，动态加载与 close guard 原样保留，查询投影和排序未改变；mock 隔离且不连接真实数据库。
- 同步数据库与前端类型规范，停止推荐入口 `any`。任务上下文校验通过。
- 未验证真实 PostgreSQL、生产构建、浏览器；未运行 backfill。历史 `S(): any`、`mapRow(any)` 等非直接阻塞项保留，仍可能遮蔽局部类型错误。
- 本轮没有启动服务或产生需清理的隐私、临时文件。

## 提交计划

- 等待用户确认后创建一个工作提交：`refactor: restore typed database access`，不推送。
- 纳入上述 11 个产品文件、新增工厂测试、两份类型规范、当前子任务目录以及父任务 PRD/task.json；未改 `panel/keys/page.tsx`、`actions/share.ts` 或现有测试夹具。
- 提交后再归档本子任务并记录日志；父路线图继续保留，包边界与聊天 SSE 尚未开始。

## 执行边界

若需修改 SQL、存量数据、业务接受范围、连接生命周期策略或明显扩大模块范围，先报告证据，
更新规划并等待确认；不把技术债治理变成隐式行为修复。
