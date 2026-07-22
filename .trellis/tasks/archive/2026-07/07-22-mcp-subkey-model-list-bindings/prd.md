# MCP 子密钥模型列表约束

## Goal

让 `/v1/mcp` 的 `list_models` 对 sub key 只返回该 key 已绑定的模型，保持模型枚举结果与实际路由权限一致。

## Background

- MCP `list_models` 当前只按 `models.ownerUserId = ctx.userId` 与 `enabled=true` 查询。
- 对 sub key 未读取 `key_model_bindings`，因此会暴露同一用户所有未绑定模型名称。
- 实际模型调用经过 `resolveRoutes`，会拒绝 sub key 未绑定模型，列表与调用权限不一致。

## Requirements

- master key 保持返回当前用户全部已启用模型。
- sub key 只返回当前用户已启用且存在该 key 绑定的模型。
- 无绑定的 sub key 返回空列表。
- 不改变 MCP 工具协议、模型调用路由或 public 模型策略。

## Acceptance Criteria

- [x] 回归测试覆盖 master key 全量、sub key 绑定过滤与空绑定。
- [x] sub key 查询同时限制 key ID、模型属主和启用状态。
- [x] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 修改 `/v1/models` 的 public 模型语义。
- 清理历史绑定或新增数据库迁移。
