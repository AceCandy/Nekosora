# MAGI 项目进化第 7 轮

## Goal

让软删除消息从聊天引用边界彻底不可见，避免隐藏客户端请求继续以墓碑消息作为父节点、分支源、编辑、重试、续写或版本切换目标。

## Requirements

- `findConversationMessage` 必须同时限定标识符、当前会话和 `deletedAt IS NULL`。
- 所有现有 helper 调用方沿用相同的“不存在”行为，不泄露消息是否因软删除而存在。
- `getMessageSiblings` 的初始目标查询也必须排除软删除消息；墓碑目标返回空结果且不继续查会话、兄弟、工具调用或反馈。
- 不改变正常未删除消息、跨会话隔离、软删除写入或公开分享读取行为。

## Acceptance Criteria

- [x] publicId 和 internal id 两种 helper 查询都包含会话与未删除条件。
- [x] 软删除目标不能用于 API parent/source/user/continue 引用或 branch 编辑/重试/续写。
- [x] 软删除版本目标不能通过 `getMessageSiblings` 返回 current 或兄弟数据。
- [x] 正常消息与跨会话拒绝行为不回归。
- [x] lint、typecheck、全量测试和生产构建通过。

## Out Of Scope

- 新增消息恢复或回收站功能。
- 解决查找后并发软删除的事务竞态。
- 修改重复软删除或分享页面行为。
