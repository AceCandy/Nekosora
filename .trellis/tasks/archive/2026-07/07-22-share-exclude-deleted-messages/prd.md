# 分享排除已删除消息

## Goal

确保创建公开会话分享时只包含当前仍可见的消息，避免已经软删除的内容重新出现在公开分享页。

## Background

- 会话读取与分支操作统一通过 `messages.deletedAt IS NULL` 排除软删除消息。
- `createShare` 当前只按 `conversationId` 查询消息 public ID，会把已软删除消息写入 `messageIdsJson`。
- `getShare` 会按该 ID 清单读取消息，因此分享前已删除、聊天界面不可见的内容仍会公开。

## Requirements

- `createShare` 的消息查询必须同时限制目标 `conversationId` 与 `deletedAt IS NULL`。
- 分享记录中的 `messageIdsJson` 和 `defaultMessageIdsJson` 只能包含创建时未删除的消息。
- 保持会话属主校验、消息顺序、分享读取和撤销行为不变。
- 不改变分享创建后消息被编辑或删除时的现有语义，不引入内容快照或数据库迁移。

## Acceptance Criteria

- [x] 回归测试证明分享消息查询组合 `conversationId` 与 `deletedAt IS NULL`。
- [x] 插入分享记录时两个消息 ID 清单均不包含已删除消息。
- [x] 现有分享撤销测试继续通过。
- [x] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 将消息正文复制进分享记录以形成不可变快照。
- 分享创建后自动响应消息编辑、软删除或物理删除。
- 前端分享交互调整。
