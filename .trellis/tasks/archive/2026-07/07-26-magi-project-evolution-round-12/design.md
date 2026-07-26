# Technical Design

## Boundary

在 `src/lib/chat/message-reference.ts` 增加会话消息写辅助函数：开启短事务，按 `conversationId + userId` 查询并 `FOR UPDATE` 锁定会话行，随后执行调用方的消息校验与写入回调。`/api/chat` 与 branch actions 的全部消息写点使用同一锁；流式生成、MCP、RAG、标题与记忆任务保持事务外。

## Concurrency Model

- 会话行是每个 conversation 的唯一写互斥点，不需要新增表、索引或迁移。
- 锁获取后再读取消息引用和当前消息树，保证等待其他写事务后观察到最新已提交状态。
- 所有仓库内消息写点都先获取同一锁，因此“读取子树 -> 删除/更新”和“验证父节点 -> 插入/更新子节点”不会交错。
- 最终 update 仍携带 `conversationId`、role、`deletedAt IS NULL` 和内容版本条件，并检查 `returning` 结果，防止遗漏调用点或非协作写入造成假成功。
- 模型生成不持锁；若生成期间引用改变，最终事务拒绝持久化生成结果。

## Data Flow

```text
send 新 user
  -> 初始引用校验（早失败）
  -> transaction + lock conversation
  -> 重新校验 parent/source
  -> insert user -> commit
  -> 上下文准备与模型流（无锁）

retry/edit/send assistant 收尾
  -> transaction + lock conversation
  -> 重新校验 user 父消息 active + role=user + content=生成版本
  -> 重新校验可选 source active
  -> insert assistant -> commit

continue 收尾
  -> transaction + lock conversation
  -> 校验 parent user active + content=生成版本
  -> conditional UPDATE assistant
       id + conversation + role=assistant + deletedAt IS NULL + content=原 prefix
  -> returning 为空则失败

edit / soft delete
  -> transaction + lock conversation
  -> 重新解析目标并读取最新 active 消息树
  -> 删除或软删除完整子树
  -> edit 条件更新原 user，未命中则事务回滚
```

## Contracts

- `withConversationMessageWrite` 只在已授权 `conversationId + userId` 命中时调用回调；不存在或失去属主时返回无结果。
- callback 接收事务对象，禁止在 callback 内回退到外层 `db`，否则会绕过同一连接上的行锁事务。
- route 初始查询保留既有 400/403 早失败；最终事务的重新校验负责并发正确性。
- user 内容版本以数据库字符串与本次请求实际使用的最后一条 user 内容比较。内容不一致表示请求快照已过期。
- continue 内容版本以初始 assistant prefix 为 CAS 条件；两个并发 continue 从同一 prefix 开始时最多一个成功。
- 持久化异常沿用 route 现有 catch：`persistenceFailed=true`、best-effort 清除 generating、发送脱敏 error、跳过 `[DONE]`，最终 run 状态为 failed。

## Validation Matrix

| 竞态 | 锁后状态 | 结果 |
| --- | --- | --- |
| parent/source 在新 user 插入前被删除 | 重新查询不可见 | 400，不插入 user |
| user 在 assistant 收尾前被软删除/物理删除 | active user 查询为空 | error SSE，无 assistant、无 DONE |
| user 在生成期间被编辑 | content 与快照不一致 | error SSE，无 assistant、无 DONE |
| continue 目标被软删除/物理删除 | 条件 UPDATE 0 行 | error SSE，无 DONE |
| 两个 continue 使用相同 prefix | 第一个更新后改变 content | 第二个 UPDATE 0 行并失败 |
| edit/delete 等待正在提交的 child insert | 获锁后读取最新树 | 新 child 纳入删除集合 |
| child 收尾等待 edit/delete | 获锁后父节点已改变/不可见 | child 写入失败 |

## Compatibility And Trade-Offs

- 选择会话行锁而非长事务：完整覆盖应用内写入交错，同时不占用连接等待模型响应。
- 选择共同写锁加条件写，而非“最终再查一次”：后者在最后查询与写入之间仍有 TOCTOU。
- 不使用 trigger/FK：软删除可见性和内容版本不适合普通 FK 表达，且迁移扩大回滚面。
- 并发失效时宁可丢弃已生成结果并明确报错，也不保存孤儿、覆盖其他续写或发送虚假完成信号。

## Rollback

变更仅涉及 TypeScript 代码、测试和规范。回滚对应提交即可恢复旧行为，无数据库迁移或数据回滚步骤。
