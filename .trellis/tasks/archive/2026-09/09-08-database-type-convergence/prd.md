# 数据库访问类型收敛

## Goal

恢复数据库入口到查询调用方的类型检查，让错误表名、列值和事务参数在开发阶段暴露；保持现有数据库及业务行为不变。

## Background

- 上一批 `a4b77a9` 已将现有测试纳入类型检查，并启用零警告 lint。
- `packages/db/src/index.ts:15` 的 `AnyDb = any` 和 `:20` 的 `AnySchema = Record<string, any>` 是入口类型丢失点；Core 入口仅转发该包。
- 项目已经 PostgreSQL-only，已安装 Drizzle 0.45.2；其 `NodePgDatabase<TSchema>` 和 `drizzle` 返回类型可直接复用，无需新增数据库抽象。
- 在内存中仅替换这两个类型、未写源码的预检：Web 链出现 15 条诊断，分布于 10 个文件；Gateway 链 7 条、Worker 链 4 条，均指向相同 Core 调用方，不是额外独立问题。
- 典型问题：`packages/core/src/lib/conversation-title/service.ts:77,213` 等把事务对象标成完整连接；`packages/core/src/lib/rag/processing-repository.ts:73`、`packages/core/src/lib/usage-aggregate.ts:41` 将 SQL 表达式写成 `unknown`；`packages/core/src/lib/keys.ts:61` 等再次把 Schema 强转 `any`。
- `apps/web/src/features/chat/lib/share-rate-limit.ts:23,78` 的接口声称接受任意 `unknown` 查询，超过真实驱动支持范围，应按实际 SQL 输入和异步查询结果收窄。

## Requirements

- R1：`getDb()` / `getSchema()` 使用实际 Drizzle、Schema、Pool 类型，移除入口 `any` 和不必要的连接断言；保持现有 API 名称，不新增平行的 typed API。
- R2：只修复恢复入口类型后直接受影响的事务签名、Schema 强转、查询投影和 SQL 参数签名；保留原有字段、过滤、排序、事务边界、锁顺序和结果转换。
- R3：驱动与 Schema 继续使用字面量动态 import；新增类型引用必须是 type-only。连接池上限、单飞初始化、失败重试、关闭语义和错误文本保持不变。
- R4：复用 Core 现有测试入口补数据库工厂与类型回归；同步数据库规范中的弱类型说明和已迁移路径，不新增依赖或空检查脚本。

## Acceptance Criteria

- [x] AC1/R1：数据库入口不再返回 `any`；Schema 表/列与查询结果可推断，类型回归在常规 typecheck 中执行。
- [x] AC2/R2：直接调用方通过 strict 类型检查，无新增 `any`、`as never` 或忽略诊断来规避问题；SQL、返回字段、鉴权和事务语义不变。
- [x] AC3/R3：测试覆盖初始化前 Schema 访问、并发复用连接、初始化失败后重试，以及关闭后重新获取连接；无真实数据库连接或密钥依赖。
- [x] AC4/R4：`pnpm check` 零警告通过，`pnpm test` 通过且无新增跳过，受影响契约测试保留；独立复核通过，规范同步。
- [x] AC5：报告实际执行的验证和未执行的 PostgreSQL、构建、浏览器验证，不以 mock 结果替代这些验证。

## Out of Scope

- 不改 Schema、迁移、存量数据、SQL 行为、连接生命周期策略或依赖版本。
- 不全仓清除所有历史 `any`，不重写仓储、迁移引擎、包边界或聊天 SSE；无关历史类型债留给后续批次。
- 若类型恢复揭示需要改数据或业务语义的问题，记录证据并暂停该项，不在本批隐式决定修复行为。
