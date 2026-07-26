# MAGI 项目进化第 12 轮

## Goal

保证聊天消息树的引用校验与写入在并发编辑、删除和续写下保持一致，避免新消息挂到已删除或已换代的父节点、续写覆盖其他结果，以及持久化失败后仍向客户端发送完成信号。

## Background

- `src/app/api/chat/route.ts:115-210` 先解析 parent/source/user/continue 引用，再经过上下文准备和长时流生成，最后在 `:413-437` 更新或插入 assistant；校验与写入之间没有共同的并发边界。
- `src/features/chat/actions/branch.ts:290-361,477-520` 的编辑和软删除先读取消息树、计算后代，再分别执行删除/更新；并发生成可在快照后插入漏网子节点。
- `src/lib/chat/message-reference.ts:16-27` 已保证单次查询限定当前会话且排除软删除，但重复查询不能消除查询与写入之间的 TOCTOU 窗口。
- `messages.parentId/sourceId` 没有数据库外键或跨行可见性约束，数据库不会自动拒绝指向已软删除消息的引用。

## Requirements

- 所有消息树写操作必须按会话共用一个短事务并发边界：新 user 插入、assistant 插入、continue 更新、edit 子树删除与原消息更新、soft delete 子树更新。
- 并发边界只覆盖数据库校验与写入，不能跨模型上下文准备或流式生成持有事务/行锁。
- 新 user 插入前必须在同一短事务内重新确认 parent/source 仍属于当前会话且未软删除；无效引用不得产生新消息。
- assistant 最终插入前必须重新确认其 user 父消息仍存在、未软删除、角色仍为 user，且内容与生成开始时使用的版本一致。
- retry 提供 source 引用时，最终写入前必须重新确认 source 仍是当前会话内未删除的消息。
- continue 最终更新必须同时限定目标 id、conversationId、assistant 角色、`deletedAt IS NULL` 和原始内容版本；并发续写只允许第一个匹配原始版本的结果成功。
- edit 必须在同一短事务内重新解析目标、读取当前消息树、删除后代并条件更新原 user；条件更新未命中时整笔操作回滚。
- soft delete 必须在同一短事务锁内重新解析目标、读取当前消息树并条件更新完整子树；不能漏掉等待锁期间已经提交的子节点。
- 最终引用失效或条件写未命中时，本次 run 必须收敛为失败，清除 generating 标记，发送脱敏错误帧且不发送 `[DONE]`。
- 保持现有 WebChat 请求字段、SSE 事件结构、正常 send/retry/edit/continue 行为和错误隔离语义。

## Acceptance Criteria

- [x] 同一会话的消息写操作通过 PostgreSQL 会话行短事务锁串行化，锁在模型生成前释放、仅在数据库收尾时重新获取。
- [x] parent/source 在校验后被并发删除时，新 user 不会插入；等待删除事务后开始的插入能看到最新状态并失败。
- [x] user 父消息在生成期间被编辑、软删除或物理删除时，assistant 不会落库，SSE 有错误帧且没有 `[DONE]`。
- [x] continue 目标在生成期间被删除、改写或被另一续写抢先更新时，当前更新影响零行并按持久化失败处理。
- [x] edit/soft delete 在持锁后读取最新子树，并发生成不能在它们的快照与写入之间留下孤儿或漏删节点。
- [x] 跨会话、已删除和角色不匹配引用仍保持既有拒绝行为，正常 send/retry/edit/continue 回归通过。
- [x] 不新增 schema 或迁移；聚焦测试、lint、typecheck、全量测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 为全部历史消息引入版本列、乐观锁 token 或客户端协议字段。
- 在整个模型生成期间持有数据库事务或消息行锁。
- 修复模型路由绑定、会话 `generating` 布尔值计数等其他并发问题。
- 新增 `parentId/sourceId` 外键、触发器或数据库迁移。
- 改变 retry 多版本分支的产品语义；同一有效 source 的并发 retry 仍可形成多个 assistant 版本。

## Risks And Deferred Items

- 同一会话的短时数据库写会串行化，但不会阻塞上游模型流；事务内查询规模沿用当前整棵会话消息树读取，性能特征不扩大。
- 最终校验失败时，用户已看见的流式增量会以错误结束并在刷新后消失；这是避免保存错误引用的明确一致性取舍。
- 本轮以应用内所有六个消息写点共同遵守会话锁为前提；仓库外直接写库不在应用协议保证范围内，最终条件谓词仍提供额外防御。
