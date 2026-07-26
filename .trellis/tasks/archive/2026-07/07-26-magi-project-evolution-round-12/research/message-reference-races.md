# Message Reference Race Research

## Repository Evidence

- `src/app/api/chat/route.ts:115-135` 分别查询 parent/source 并保存内部 id；新 user 到 `:195-210` 才插入，引用可在两个步骤之间失效。
- `src/app/api/chat/route.ts:143-168` 校验 continue assistant 与 user parent；流结束后 `:413-424` 只按 assistant id 更新，不限制 conversation、role、deletedAt 或原内容，也不检查影响行数。
- `src/app/api/chat/route.ts:185-210,426-437` 校验或创建 user 后，跨越上下文准备和模型流才插入 assistant；期间 edit/delete 可让父消息失效或换代。
- `src/features/chat/actions/branch.ts:290-361` 的 edit 先读取全树计算 descendants，再 delete descendants、按 id update user；并发 assistant insert 可漏出快照或写到旧内容版本。
- `src/features/chat/actions/branch.ts:477-520` 的 soft delete 同样先读取全树后批量更新；快照后插入的 child 不在 targetIds 中。
- `src/lib/chat/message-reference.ts:16-27` 查询已经组合 identifier、conversationId 与 `deletedAt IS NULL`，因此问题不在单次授权范围，而在查询和写入缺少共同原子边界。
- `src/db/schema/pg.ts:334-363` 中 parentId/sourceId/runId 均为普通 nullable text；只有 conversationId 有 FK。数据库不会阻止不存在、跨会话或已软删除引用。

## Reproducible Event Sequences

1. route 校验 parent active；delete 读取旧树并软删除 parent；route 随后插入 user，产生可见性断链的 child。
2. route 校验 reused user；edit 删除旧 descendants 并改写 user；route 使用旧 prompt 生成后插入 assistant，回答与数据库 user 内容不一致。
3. continue A/B 同时读取相同 prefix；A 更新成功；B 仍按 id 更新并覆盖 A，两个响应都收到 DONE。
4. edit/delete 先读取 descendants；route 在批量写之前插入新 assistant；新行不在预先计算的集合中，成为漏删后代。
5. continue 校验后目标被软删除或 edit 物理删除；最终按 id update 可能改写 tombstone或影响零行，但现有代码仍继续发送 DONE。

## Scope Decision

本轮覆盖仓库内全部消息写点，通过共同的会话短事务锁消除交错，并在长时生成后的最终写入增加版本条件。历史上下文的每一条消息不新增版本 token；目标、父节点与 source 的引用完整性是本轮核心边界。
