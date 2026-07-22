# 密钥状态写入属主约束

## Goal

让低层 API key 状态写入本身携带用户属主条件，避免未来调用方遗漏前置校验时按全局 key ID 修改他人密钥。

## Requirements

- `setKeyEnabled` 必须接收 `userId`，更新 SQL 同时限制 key ID 与用户 ID。
- `disableKey` 必须把当前 session user ID 传入低层写入。
- 保留 action 层现有属主检查与禁用行为。
- 不改变 key schema、启用状态语义或其他密钥流程。

## Acceptance Criteria

- [x] 低层单测断言更新条件同时包含 `apiKeys.id` 与 `apiKeys.userId`。
- [x] action 测试断言当前用户 ID 被传入低层写入。
- [x] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 修改密钥创建、验证或绑定流程。
- 数据库迁移。
