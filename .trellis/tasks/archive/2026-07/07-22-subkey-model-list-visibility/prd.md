# 子密钥模型列表可见性

## Goal

恢复网关 owner-only 契约：sub key 只能绑定、枚举和调用 key 所属用户自己创建的模型，public visibility 不构成跨用户网关授权。

## Background

- 当前绑定候选和新绑定入口错误地允许任意用户的 public 模型。
- 存量数据库可能仍含修复前创建的非法跨用户 private 模型绑定。
- 网关实际路由按 `modelName + ctx.userId` 校验属主，但 `/v1/models` 的 sub key 分支只按 `modelId + enabled` 查询，会暴露跨用户模型元数据。
- 2026-07-11 的资源统一决策明确规定：`/v1/*` 只能访问请求用户自己创建的模型，public 对网关不可见。

## Requirements

- `getBindableModels` 只返回当前用户拥有的 enabled 模型，不因 public visibility 放宽给其他用户。
- `bindModel` 必须要求 `models.ownerUserId = session.user.id` 与 `enabled=true`。
- `/v1/models` 的 sub key 绑定模型查询必须要求 `models.ownerUserId = ctx.userId` 与 `enabled=true`。
- 保持 master key 列表、路由解析和 WebChat 的 public 可见性不变。

## Acceptance Criteria

- [x] action 测试证明他人 public/private 模型均不可绑定，本人 enabled 模型可绑定。
- [x] `/v1/models` 测试证明跨用户历史绑定不会出现在 sub key 响应中。
- [x] 绑定候选只包含当前用户 enabled 模型。
- [x] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 清理存量绑定数据或新增迁移。
- WebChat `public ∪ owner` 可见性与模型发布流程。
