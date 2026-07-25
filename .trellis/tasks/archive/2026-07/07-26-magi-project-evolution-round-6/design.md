# Technical Design

## Boundary

改动限制在 `getShare` 的消息状态读取和对应 action 测试，不修改数据库结构或消息写操作。

## Three-State Read Contract

新分享的正文来自 `message_snapshots_json`，当前消息表只决定是否发生显式撤回：

| 当前消息状态 | 新分享 | 历史 null 快照分享 |
| --- | --- | --- |
| 存在且 `deletedAt IS NULL` | 返回冻结正文 | 返回实时正文 |
| 存在且 `deletedAt IS NOT NULL` | 隐藏 | 隐藏 |
| 物理缺失 | 返回冻结正文 | 隐藏 |

物理缺失表示编辑主线清除了后代，而不是显式删除撤回；只有保留下来的 `deletedAt` 墓碑代表需要从公开链接隐藏。

## Query And Transform

1. 从分享记录取得有序 `messageIdsJson` 和可选正文快照。
2. 查询分享所属会话中 publicId 位于该 ID 集合的消息，不添加 `isNull(deletedAt)`，以便区分未删除与软删除。
3. 新分享按正文快照顺序过滤：对应行不存在或 `deletedAt` 为空时保留；明确非空时隐藏。
4. 历史分享按 `messageIdsJson` 顺序映射当前行，仅保留 `deletedAt` 为空的行并读取实时正文。

## Compatibility And Security

- 不改变公开返回 DTO、分享 URL、状态检查或访问时间更新。
- 查询继续包含 `conversationId`，并新增 `inArray(publicId, messageIds)` 缩小读取集合。
- 不回填或推断历史正文；历史记录物理缺失时没有可信内容，因此继续隐藏。

## Rollback

改动不含迁移，可单独回退 `getShare` 和测试。回退后仅恢复已知的编辑后快照丢失行为。
