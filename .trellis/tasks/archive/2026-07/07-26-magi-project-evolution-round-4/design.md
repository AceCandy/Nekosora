# Technical Design

## Scope And Boundaries

本轮修改分享参数在 Client Component、页面 Server Action wrapper 与 chat action 之间的传递，并加强创建分享时的数据库校验。不修改数据库结构、公开分享 DTO 或页面样式。

## Data Flow

1. `ChatComposer` 读取点击时实际渲染的 `runtime.messages`。
2. 仅当非流式、消息非空且每条都有 `publicId` 时，按显示顺序生成 `messagePublicIds: string[]`；否则向 `ChatHeader` 传空列表以禁用分享。
3. `ChatHeader` 调用 `createShareAction(conversationId, messagePublicIds)`。
4. 页面 wrapper 原样把两个参数传给 `createShare`。
5. `createShare` 先验证会话属主和输入集合，再查询该会话内 `deletedAt IS NULL` 且 publicId 在请求集合中的消息。
6. 只有查询结果与去重后的请求集合完全相等时才 insert；insert 中两个 ID JSON 字段保留请求顺序。
7. `getShare` 继续按已保存 ID 顺序恢复消息，并过滤读取时已软删除的消息。

## Contracts

- `createShare(conversationId: string, messagePublicIds: string[]): Promise<string>`
- `createShareAction` 与 `ChatHeader` 使用相同签名。
- 空数组代表客户端当前不可安全分享，仅用于禁用按钮；若绕过 UI 调用，服务端抛出“分享消息无效”。
- 重复、缺失、跨会话、跨用户或软删除 ID 统一抛出“分享消息无效”，不暴露具体 ID 状态。
- 数据库查询只负责集合授权，`messagePublicIds` 负责快照顺序。

## Security And Compatibility

- 会话属主校验仍在消息校验之前执行。
- 消息查询同时限定 `conversationId`、`deletedAt IS NULL` 与请求 ID 集合；结果数量和集合必须完全匹配。
- 不要求 ID 构成连续父链，因为现有客户端版本切换可能产生“中间版本替换、后续消息保留”的真实屏幕状态。
- 函数签名是内部 Server Action 契约，不是公开 HTTP API；所有仓库调用方同步修改。
- 不迁移历史 share，旧记录读取保持兼容。

## Tradeoffs

- 选择客户端有序 ID + 服务端授权集合，而不是服务端重算主线：前者准确表达点击时屏幕状态。
- 不持久化当前版本选择：避免扩大数据库与会话状态范围。
- 不引入新 DTO/helper：参数结构简单，保持改动直接。

## Rollback

回滚本轮代码与测试即可恢复旧签名和全会话快照；无数据库迁移或不可逆数据改动。
