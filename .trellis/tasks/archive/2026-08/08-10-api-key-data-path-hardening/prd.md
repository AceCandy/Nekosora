# API Key 数据路径加固

## Goal

让 API Key 鉴权热路径具备稳定查询性能，确保密钥展示遵循最小暴露原则，并移除没有实际授权语义的父子关系。

## Background

- `packages/core/src/lib/keys.ts:164-178` 的每次鉴权按 `keyPrefix` 查询，`packages/db/src/schema.ts:127-133` 未定义对应索引。
- `packages/core/src/lib/keys.ts:126-131` 使用全列查询，结果经 `apps/web/src/app/(dash)/panel/keys/page.tsx:19-76` 进入 Client Component。
- `packages/db/src/schema.ts:118` 的 `parentId` 只在创建子 Key 时写入；鉴权、路由、模型绑定、禁用和配额均不读取它。
- 子 Key 的真实权限边界由 `kind="sub"`、当前 Key ID 和 `key_model_bindings` 决定；禁用主 Key 不会禁用子 Key。
- 产品保留“每用户一个不受模型绑定限制的主 Key + 多个按模型绑定的子 Key”，但不再把两类凭据建模为数据库父子关系。

## Requirements

- R1. 为 `verifyKey` 的 `keyPrefix` 候选查询提供与真实 SQL 条件匹配的 PostgreSQL 索引，并用查询计划或等价证据验证命中。
- R2. 保留 legacy prefix 与当前 preview 格式兼容，不降低最终 hash 常量时间比较和用户状态校验。
- R3. `listKeys` 与 `getBindableModels` 使用显式展示 DTO；`keyHash`、模型 `systemPrompt` 等存储字段不得查询、序列化或传入 Client Component。
- R4. 从运行时代码、Drizzle schema 和 PostgreSQL 表中移除 `parentId` 及其索引；保留现有 master/sub 创建、鉴权和模型绑定行为。
- R5. 数据变更同步 SQL migration、Drizzle journal/snapshot 和索引/列移除测试，并提供协调上线与回滚说明。
- R6. 物理删列采用维护窗口发布：停止 Web、Gateway 和 Worker，确认数据库没有应用连接并完成一致性备份后，由新制品单独执行迁移；禁止与旧实例并行滚动迁移。

## Acceptance Criteria

- [x] 鉴权查询在代表性数据量下使用预期索引，行为与旧 Key 兼容。
- [x] 浏览器/RSC 数据中不再出现 `keyHash` 或绑定模型的存储专用字段。
- [x] `parentId` 与 `api_keys_parent_idx` 从代码和 PostgreSQL schema 移除，master/sub 与子 Key 模型绑定行为保持不变。
- [x] 上线与回滚步骤覆盖停止服务、连接排空、迁移前备份、单独迁移、恢复流量前验证及迁移账本一致性。
- [x] 数据库定向测试、`pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 更换 API Key 字符串格式或强制轮换现有 Key。
- 新增 Key 物理删除入口，或改变“禁用主 Key 不自动禁用子 Key”的现有行为。
- 取消 master/sub 类型、改变子 Key 模型绑定规则或新增权限继承。
- 在迁移后已经恢复写流量的情况下，用旧数据库快照覆盖新增业务数据。
