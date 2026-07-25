# MAGI 项目进化第 3 轮

## Goal

消除 `softDeleteMessage` 对跨用户消息存在性和消息角色的泄露，使未授权调用与目标不存在对调用者不可区分，同时保持属主删除消息及其后代的既有行为。

## Background

- `softDeleteMessage` 当前先按 `messagePublicId` 查询消息并校验角色，之后才查询会话属主（`src/features/chat/actions/branch.ts:482`）。
- 因此其他登录用户可通过“消息不存在”“仅支持删除用户消息”“无权操作”三种错误判断公开 ID 是否有效及消息角色。
- 同模块已有属主隔离测试，但 `softDeleteMessage` 没有覆盖（`src/features/chat/actions/branch.test.ts:74`）。
- 上一轮 MAGI 已将该权限边界列为后续优先候选（`.trellis/tasks/archive/2026-07/07-25-magi-reliability-round-2/prd.md:39`）。

## Requirements

- `softDeleteMessage` 必须在暴露消息角色前确认目标消息所属会话归当前用户所有。
- 目标消息不存在、会话不存在或目标会话不属于当前用户时，必须统一抛出“消息不存在”。
- 当前用户拥有目标会话时，仍只允许删除 `user` 消息；属主删除其他角色时继续抛出“仅支持删除用户消息”。
- 拒绝未授权调用时不得执行消息更新；合法删除的子树收集、软删除和返回 publicId 列表语义保持不变。
- 修改仅限 action 与定向单元测试，不新增数据库迁移、公共 API、抽象或配置。

## Acceptance Criteria

- [x] 其他用户传入一个真实的 `user` 消息 publicId 时收到“消息不存在”，且数据库不执行 update。
- [x] 其他用户传入一个真实的非 `user` 消息 publicId 时也收到“消息不存在”，不泄露角色，且数据库不执行 update。
- [x] 不存在的消息 publicId 仍收到“消息不存在”，且数据库不执行 update。
- [x] 属主传入非 `user` 消息时仍收到“仅支持删除用户消息”，且数据库不执行 update。
- [x] 属主删除 `user` 消息时，既有子树软删除与返回 ID 行为不回归。
- [x] `src/features/chat/actions/branch.test.ts` 定向测试通过；项目 lint、typecheck 和测试质量门通过。

## Out Of Scope

- 调整其他会话 action 的错误文案或权限策略。
- 通过联表或公共 helper 重构所有属主校验。
- 真实 PostgreSQL 集成测试、数据库迁移或性能优化。
- 本轮审视发现的其他候选，包括分享快照混入重生成旧分支、网关 tools 支持、非流式 cacheKey 和 CI 门禁。

## Risks And Deferred Items

- 单元测试使用链式数据库 mock，只验证权限分支与写操作门禁；真实 PostgreSQL 行为不在本轮验证范围。
- 分享快照可能包含重生成旧分支，具备潜在内容泄露影响，作为下一轮优先审视候选。
