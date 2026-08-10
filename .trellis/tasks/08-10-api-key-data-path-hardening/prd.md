# API Key 数据路径加固

## Goal

让 API Key 鉴权热路径具备稳定查询性能，并确保密钥展示和父子关系遵循最小暴露与数据库完整性原则。

## Background

- `packages/core/src/lib/keys.ts:164-178` 的每次鉴权按 `keyPrefix` 查询，`packages/db/src/schema.ts:127-133` 未定义对应索引。
- `packages/core/src/lib/keys.ts:126-131` 使用全列查询，结果经 `apps/web/src/app/(dash)/panel/keys/page.tsx:19-76` 进入 Client Component。
- `packages/db/src/schema.ts:118` 的 `parentId` 未声明自引用外键。

## Requirements

- R1. 为 `verifyKey` 的 `keyPrefix` 候选查询提供与真实 SQL 条件匹配的 PostgreSQL 索引，并用查询计划或等价证据验证命中。
- R2. 保留 legacy prefix 与当前 preview 格式兼容，不降低最终 hash 常量时间比较和用户状态校验。
- R3. `listKeys` 使用显式展示 DTO，`keyHash` 不得查询、序列化或传入 Client Component。
- R4. `parentId` 增加明确删除策略的自引用完整性约束；迁移前检查孤儿、跨用户和错误 kind 数据，不静默删除或改写用户数据。
- R5. 数据变更同步 SQL migration、Drizzle journal/snapshot 和索引/约束测试，并提供上线与回滚说明。

## Acceptance Criteria

- [ ] 鉴权查询在代表性数据量下使用预期索引，行为与旧 Key 兼容。
- [ ] 浏览器/RSC 数据中不再出现 `keyHash`。
- [ ] 数据库拒绝悬挂父 Key；既有异常数据在迁移前被显式报告。
- [ ] 数据库定向测试、`pnpm check`、`pnpm test` 与独立复核通过。

## Out Of Scope

- 更换 API Key 字符串格式或强制轮换现有 Key。
- 未经单独审批删除存量异常数据。
