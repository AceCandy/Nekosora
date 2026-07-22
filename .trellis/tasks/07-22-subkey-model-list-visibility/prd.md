# 子密钥模型列表可见性

## Goal

确保 `/v1/models` 为 sub key 解析历史绑定时仍执行模型可见性校验，不泄露其他用户 private 模型的名称。

## Background

- 新绑定入口已限制为已启用 public 模型或当前用户拥有的已启用模型。
- 存量数据库可能仍含修复前创建的非法跨用户 private 模型绑定。
- 网关实际路由按 `modelName + ctx.userId` 再校验属主，但 `/v1/models` 的 sub key 分支只按 `modelId + enabled` 查询，会暴露模型元数据。

## Requirements

- sub key 的绑定模型查询必须同时要求模型已启用，且 `visibility='public'` 或 `ownerUserId=ctx.userId`。
- 保持 public 模型与当前用户 private 模型的既有列表行为。
- 不改变 master key 列表、路由解析或 public 模型产品策略。

## Acceptance Criteria

- [ ] 路由测试证明他人 private 模型即使存在绑定也不会出现在响应中。
- [ ] public 模型与本人 private 模型仍正常返回。
- [ ] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 清理存量绑定数据或新增迁移。
- 统一网关 owner-only 规范与 public 子 key 绑定 UI 的产品语义。

## Open Question

- `gateway-routing.md` 规定 `/v1/*` owner-only 且 public 模型不可列/调，但 `getBindableModels`、key 管理 UI 与现有绑定行为允许 sub key 绑定 public 模型。需要确认 sub key 是否是 public 模型的例外；该决定会改变 `/v1/models` 的对外结果，未确认前不实施读取规则变更。
