# Message Write Concurrency Strategy

## Options Evaluated

### Long transaction across generation

在模型调用前锁定 message/conversation 并一直持有到流结束。一致性最强，但会长时间占用连接并阻塞编辑、删除和其他发送；不适合外部模型延迟，拒绝采用。

### Re-query immediately before write

实现最小，但重新查询与随后 INSERT/UPDATE 之间仍有 TOCTOU；只能改善常见窗口，不能建立不变量，拒绝作为唯一方案。

### Atomic conditional SQL only

最终 UPDATE 可可靠使用条件谓词和 `returning`。INSERT 同时验证多个可选引用可以用 `INSERT ... SELECT/EXISTS`，但 edit/delete 仍需从动态树快照计算后代；单条 SQL 不能简单覆盖全部交错。

### Conversation row short transaction lock plus conditional writes

推荐方案。所有应用内消息写先 `SELECT` 当前属主会话 `FOR UPDATE`，然后在同一 transaction 中读取最新消息状态并写入。每次锁只覆盖数据库语句，不跨模型流；edit/delete 获锁后能看到等待期间已提交的 child。最终 continue/edit 继续用条件 UPDATE + `returning` 检查，形成第二层防御。

## Why Conversation Row

- 每条消息都已绑定 conversationId，天然提供稳定、唯一、无需迁移的锁目标。
- 仓库内消息写点只有 route 的三类写和 branch 的三类写，能够完整迁移到同一协议。
- 相比 advisory lock，不存在 hash 冲突，也不需要另行定义锁 key 算法。
- 相比逐消息锁，不需要事先知道整棵动态后代集合，且统一锁顺序避免多行锁顺序死锁。

## Remaining Defense

- continue：`id + conversationId + role=assistant + deletedAt IS NULL + content=originalPrefix`。
- edit：`id + conversationId + role=user + deletedAt IS NULL` 并检查 returning；失败令 descendants delete 回滚。
- soft delete：`conversationId + target ids + deletedAt IS NULL`。
- assistant insert：锁内重新解析 active user/source，并比较 user 内容版本。
