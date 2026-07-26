# Conversation Title Outbox Research

## Confirmed Failure Chain

- `writeFallbackTitle` 先提交 conversation 标题更新：`src/lib/conversation-title/service.ts:45-68`。
- route 随后启动未等待的 `getQueue().send("conversation-title", job)`：`src/app/api/chat/route.ts:260-279`。
- send reject 只记录脱敏日志，没有数据库状态、补偿扫描或再次投递入口。
- 进程可在 fallback commit 后、pg-boss insert 前退出；此时 catch 也不会运行，用户永久停留在 fallback。
- 第 21 轮已确认 worker/queue 会传播生成 rejection，且标题更新只覆盖默认值或本轮 fallback：`src/lib/conversation-title/service.ts:70-130`、`src/worker.ts:51-56`、`src/lib/infra/queue.ts:130-138`。

## Existing Recovery Pattern

- 文件处理使用数据库 durable state + 数据库时间到期判断 + worker 周期扫描，而不是依赖 producer Promise：`src/lib/rag/recovery.ts`。
- scheduler 启动立即运行、60 秒周期、单飞、`unref()`、停止等待 in-flight；单轮 25 条并顺序处理。
- worker 先停恢复调度，再停 pg-boss；启动失败会清理已启动资源：`src/worker.ts`。
- PostgreSQL 迁移必须追加 SQL、journal、snapshot 与一致性测试；当前最新迁移为 `0013_add_file_processing_lease`。

## Why Memory Extraction Is Not Selected

- `extractMemories` 同样吞掉 `memory.add` 失败，但 `mem0ai/oss` 的公开 `AddMemoryOptions` 没有 idempotency key。
- Mem0 会生成内部 memory id，并通过 LLM 做语义去重/合并；这不证明“写入成功后响应丢失”的重试是幂等。
- 项目规范禁止绕开 SDK 直接读写 `mem0_memories`。在没有可靠 operation id 的前提下直接 rethrow 可能重复记忆，因此本轮不修改该链路。

## Selected Data Model

专用表 `conversation_title_jobs`：

- `id text PRIMARY KEY`：应用生成的随机 job id，也是 stale queue message 的 fencing token。
- `conversation_id text NOT NULL UNIQUE`：每个会话最多一个当前 job，删除会话级联删除。
- `user_id text NOT NULL`：冻结投递身份并做用户级联清理。
- `first_user_message text NOT NULL`、`fallback_title text NOT NULL`。
- `chat_model text NULL`、`chat_model_id text NULL`。
- `dispatch_after timestamptz NOT NULL DEFAULT now()`。
- `created_at timestamptz NOT NULL DEFAULT now()`。
- `(dispatch_after, created_at)` 索引供稳定扫描。

相同会话再次创建 job 时按 `conversation_id` upsert 并替换 id/payload/dispatch time。旧队列消息必须先按 job id join 当前 outbox，无法命中即 no-op。

## Delivery State Machine

1. 事务内条件更新默认标题并 upsert outbox；任一步失败整体回滚。
2. immediate dispatcher 或 scanner 执行条件 UPDATE：`id=:id AND dispatch_after <= now()`，并把 `dispatch_after` 设置为 `now() + 15 minutes`，返回 payload。
3. claim 空返回表示另一个 dispatcher 已投递或尚未到期。
4. pg-boss send 成功后仍保留 outbox，直到 worker 业务完成；send 失败或 producer 退出也保留。
5. worker 在模型调用前按 job id 验证当前 outbox；生成完成后的短事务再次验证 current job，并原子更新标题、删除匹配 id。标题已变化等 no-op 只删除匹配旧 id；生成失败 reject 且保留。
6. 若 pg-boss 的本轮重试仍失败，15 分钟窗口到期后 scanner 再次发送。固定窗口避免队列故障时热循环；fallback 保证用户仍有可读标题。

这不是 exactly-once：send 成功后 producer 可能在得知结果前退出，scanner 会产生重复消息。job id 在模型调用前和最终写事务中双重 fencing，使模型执行期间的 job 替换和重复消息都安全。

## Rejected Alternatives

### 只 await 或给 send 加 timeout

拒绝。会阻塞非关键标题路径，且进程在两个提交之间退出仍丢任务。

### 从“标题等于首条消息截断”反推待处理会话

拒绝。fallback 与用户手动标题/模型输出不可可靠区分，会产生误处理和无限扫描。

### 把 outbox 字段塞进 conversations

可实现，但会把临时投递 payload、调度时间和 fencing 状态混入核心会话行，并使用户改名/会话更新承担额外并发职责。专用表的生命周期和索引更清晰，删除仍由 FK 级联。

### 建通用 background_jobs 表

暂不采用。只有标题任务已证明可安全 at-least-once；记忆任务缺少幂等保证，文件任务已有独立 durable state。通用化会产生尚无第二个正确消费者的抽象。

## Verification Boundary

- 服务测试验证 fallback + outbox 原子事务、upsert payload、模型调用前/最终事务双重 fencing、成功/no-op 删除与失败保留。
- dispatcher 测试验证数据库时间 claim、15 分钟窗口、25 条稳定扫描、单 job 隔离、scheduler 单飞与停止。
- worker/route 测试验证 immediate dispatch、两个 recovery 的启停顺序和失败清理。
- 迁移测试验证 SQL、外键/唯一约束/索引、journal 与 snapshot 连续。
- 本轮不声称 exactly-once，也不修改真实 Mem0 数据。
