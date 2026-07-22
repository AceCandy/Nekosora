# 聊天消息引用隔离设计

## Boundary

当前 conversation 已先通过 session owner 校验。之后所有消息引用都必须满足：

```text
message identifier + conversation_id = currentConversationId
```

不能只依赖 publicId 不可猜，因为 publicId 会出现在客户端消息 DTO、版本切换与分支操作中。

## Helper Contract

`findConversationMessage(db, schema, conversationId, { publicId | id })` 只允许二选一标识，DB where 始终组合 conversationId，返回单行或 null。Route 对角色和业务用途做二次验证。

## Data Flow

- parent/source：helper 未命中 -> 400；命中 -> 使用 internal id。
- userPublicId：helper + role=user -> 保存 internal id；新 user insert 用 returning 得到 internal id。
- continue：helper + role=assistant；其 parentId 通过 internal-id helper 回查同会话 user。
- assistant insert 直接使用已验证 user internal id；artifact 查询也走 helper。

## Compatibility

合法前端流程不变。此前静默忽略的非法 parent/source 改为 400；不泄露目标是否存在于其他会话。
