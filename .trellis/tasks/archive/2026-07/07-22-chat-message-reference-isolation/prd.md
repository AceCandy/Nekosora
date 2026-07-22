# 阻止聊天消息引用跨会话

## Goal

阻止客户端通过伪造 `/api/chat` 的消息 publicId，把当前用户会话的 parent/source/复用 user/续写链链接到其他会话（包括其他用户会话）。

## Background

- 会话本身已验证 `conv.userId === session.user.id`。
- `parentPublicId`、`sourcePublicId` 与最终 `userPublicId` 查询只按 message publicId，不带 conversationId。
- `continueFromPublicId` 先裸查再在内存比较 conversation；其 parentId 回查也不带 conversation 条件。
- 跨会话 parentId 会污染消息树，分支回溯可能越过当前会话边界。

## Requirements

- R1：新增可测试的消息查找 helper，publicId/internalId 查询均组合 conversationId 条件。
- R2：传入的 parent/source publicId 不存在于当前会话时返回统一 400，不降级为 null 链接。
- R3：userPublicId 必须属于当前会话且 role=user；验证后保存 internal id，assistant 持久化直接使用，不再裸查 publicId。
- R4：continueFromPublicId 必须属于当前会话且 role=assistant；parent user 回查也限制 conversationId。
- R5：artifact 回查 assistant publicId 时带 conversationId，所有无权引用统一表现为不存在。

## Acceptance Criteria

- [x] AC1：helper 单测证明 publicId 与 internalId 查询都使用 message id + conversationId 组合条件。
- [x] AC2：源码/测试证明 parent、source、user、continue 四类引用都走 helper，无裸 publicId 查询残留。
- [x] AC3：复用 user 仅接受 role=user，续写仅接受 role=assistant，非法引用在生成前返回 400。
- [x] AC4：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- 修改 publicId 生成方式或数据库约束。
- 重构 branch Server Actions。
- 修复历史已存在的跨会话 parent/source 数据。
