# 聊天动作属主隔离

## Goal

阻止聊天服务端动作使用其他会话的消息引用，或由任意已登录用户撤销他人的会话分享，确保所有写操作都受当前会话属主边界约束。

## Background

- `branch.ts` 已校验调用者拥有传入的 `conversationId`，但 `editMessage`、`retryFromMessage`、`continueMessage` 仍按全局消息 `publicId` 或内部 `id` 查询目标消息。
- `editMessage` 可因此直接更新其他会话中的用户消息，是可写型 BOLA 风险。
- `share.ts` 的 `revokeShare` 只要求登录，随后按 `shareId` 更新分享记录，未校验分享所属会话的用户。
- 项目已有 `findConversationMessage`，可在指定会话内解析消息引用，无需新增通用抽象或迁移。

## Requirements

- `retryFromMessage`、`editMessage`、`continueMessage` 的客户端消息引用和父消息引用必须限制在已授权的 `conversationId` 内。
- `getMessageSiblings` 查询同父兄弟时必须同时限制原消息所属会话，避免异常跨会话父子数据扩大读取范围。
- 跨会话消息引用与不存在的消息使用相同错误行为，不泄露其他会话消息是否存在。
- `revokeShare` 必须验证当前用户拥有分享记录关联的会话，再执行撤销更新。
- 保持正常同会话分支动作、公开读取分享和本人撤销分享的现有行为。
- 修改范围限于聊天分支/分享动作、聚焦测试和对应后端规范；不改变数据库结构与分享快照语义。

## Acceptance Criteria

- [x] 跨会话用户消息不能被 `editMessage` 更新或触发后代删除。
- [x] 跨会话 assistant 消息不能用于重试或续写；其父消息也不能越过当前会话边界。
- [x] 兄弟消息查询的 SQL 同时限制 `parentId`、`conversationId` 和未删除状态。
- [x] 用户不能撤销其他用户会话的分享，失败时不执行更新。
- [x] 同会话分支动作与本人分享撤销测试通过。
- [x] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 修改分享快照的存储或读取语义。
- 数据库迁移、前端交互或错误文案调整。
- 与本次属主边界无关的聊天动作重构。
