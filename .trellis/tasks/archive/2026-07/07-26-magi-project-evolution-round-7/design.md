# Technical Design

## Boundary

在共享消息引用 helper 下沉 `deletedAt IS NULL`，覆盖 API 与 branch action 的全部引用入口；对未使用 helper 的 `getMessageSiblings` 初始查询补同一条件。

## Query Contract

`findConversationMessage` 的 SQL 条件固定为：

```text
identifier = value
AND conversation_id = currentConversationId
AND deleted_at IS NULL
```

返回值保持消息行或 `null`。调用方无需区分缺失、跨会话或软删除。

`getMessageSiblings` 继续保持现有属主校验，但初始 publicId 查询在读取会话 ID 前先排除墓碑。

## Compatibility And Rollback

正常消息查询和返回类型不变；新增条件只收紧已被所有可见列表排除的墓碑。无迁移，可独立回退 helper、siblings 查询与测试。
