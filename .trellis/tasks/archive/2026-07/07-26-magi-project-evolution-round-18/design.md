# Technical Design

## Boundary

改动限定在：

- `src/db/schema/pg.ts` 与 `drizzle/pg/0012_*`：run 租约字段、活动查询索引及迁移元数据。
- `src/lib/chat/run-lifecycle.ts`：开始、心跳、终结三类 best-effort 写入。
- `src/app/api/chat/route.ts`：心跳生命周期、移除会话布尔写入、调整 `[DONE]` 时序。
- `src/features/chat/actions/conversations.ts`：从活动 run 派生列表和轮询的 `generating`。
- 对应聚焦测试与后端 Chat/数据库契约。

不修改 Provider 调用、消息分支事务、SSE 载荷、Sidebar 视觉实现或客户端本地流状态。

## Source Of Truth

活动状态由数据库在查询时计算：

```sql
exists (
  select 1
  from runs
  where runs.conversation_id = conversations.id
    and runs.status = 'running'
    and runs.lease_expires_at > now()
)
```

`conversations.generating` 暂时保留但不再参与运行时读写。读时派生避免物化布尔值出现双写、计数漂移和租约到期后无人清理的问题。

## Lease Contract

- 新增 nullable `runs.lease_expires_at timestamptz`。
- `startRun` 插入 `status='running'` 时以 PostgreSQL `now() + interval '2 minutes'` 设置租约，并返回是否成功，仍在内部吞掉并脱敏记录 DB 错误。
- route 仅在 start 成功时每 30 秒调用 `heartbeatRun`；心跳按 `runId + status='running'` 延长到数据库当前时间之后 2 分钟。
- timer 使用 `unref`，并在所有完成、失败、abort 路径的 finally 中先清除。
- `finalizeRun` 继续只把当前 running 行改为 `success|failed|interrupted`。runId 已全局唯一，无需额外 instance owner。
- 租约只决定活动可见性，不取消模型请求；短暂数据库故障恢复后，仍处于 running 的 run 可以续租。

使用数据库时间而不是应用服务器时间，避免多实例时钟偏差改变活动判定。

## Concurrent Data Flow

```text
R1 start -> insert running, fresh lease
R2 start -> insert running, fresh lease
R1 finalize -> only R1 becomes terminal
status query -> R2 still matches EXISTS -> generating=true
R2 finalize -> no active row matches -> generating=false
```

start/finalize 均为单行原子语句；由于 UI 不再维护缓存布尔值，不需要把 conversation 行锁持有到 provider 调用结束，也不需要 active counter。

## Stream Completion Order

```text
assistant/message transaction
  -> Artifact best-effort
  -> conversation updatedAt
  -> enqueue background memory work
  -> mark persistence complete
  -> clear heartbeat timer
  -> await finalizeRun(best-effort)
  -> emit [DONE] only when persistence complete
  -> detach abort listener and close stream
```

若消息收尾失败，发送 error 帧但不发送 `[DONE]`；无论成功、失败或断连，均 clear timer 并 await `finalizeRun`。

## Query And Index

`listConversations` 与 `getGeneratingStatuses` 共享一个局部 SQL expression helper，防止两个入口的活动定义漂移。新增部分索引：

```sql
CREATE INDEX runs_active_conversation_idx
ON runs (conversation_id, lease_expires_at)
WHERE status = 'running';
```

该索引只维护活动候选行，并支持按 conversation 相关子查询后继续过滤租约时间。

## Migration And Rolling Upgrade

`0012`：

1. 添加 nullable `lease_expires_at`。
2. 设置数据库默认值 `now() + interval '2 minutes'`，使滚动升级期间仍由旧实例插入且省略该列的新 running row 也获得有限租约。
3. 为迁移时仍 running 且租约为空的旧行设置两分钟租约；旧实例不会心跳续租，窗口后新查询自然忽略。
4. 不全表更新 `conversations.generating`；新代码不读取该值，避免无必要的写锁与表更新。
5. 创建 `runs_active_conversation_idx`，同步 journal/snapshot。

不修改旧迁移。混合版本窗口内旧代码仍可能写布尔列，但新代码完全忽略它；旧实例创建的长流不会心跳续租，超过默认窗口后活动指示可能暂时消失，完成滚动升级后由新 runtime 接管完整租约生命周期。

## Alternatives Rejected

- conversation 行锁 + boolean：短锁无法覆盖整个流，单独的完成事务仍需查询其他活动 run；租约到期后缓存也不会自动翻转。
- `activeRunCount`：崩溃、重复 finalize 与补偿会造成计数漂移。
- 单一 `activeRunId` / CAS：无法表达同一会话多个并发 run，最新或最旧 run 先结束都存在错误交错。
- 启动时全量清零：在多实例或滚动启动时会误伤仍活跃的其他进程。

## Test Design

1. lifecycle tracer：start 写数据库租约，heartbeat 只续租 running run，三类写入 DB 失败均不抛。
2. active query tracer：SQL 同时约束 conversation、running、非空且大于 `now()` 的租约，列表与轮询复用同一表达式。
3. concurrency truth table：两条 fresh run 中任一终结仍为 true，最后一条终结后 false；expired/null/terminal 均为 false。
4. route timing：延迟 `finalizeRun` 时不得先观察到 `[DONE]`；resolve 后才发送；失败和 abort 清 timer 并 finalize。
5. migration metadata：`0012` SQL、partial index、旧 running grace、journal idx/tag/when 与 snapshot prevId/schema 链正确。
6. 回归现有消息持久化、tool/run 审计、SSE 与侧栏轮询测试。

## Rollback

- 代码可回滚到旧布尔读写；迁移保留的 `generating` 列支持该路径。
- `lease_expires_at` 和新索引为向后兼容的附加 schema，旧代码会忽略。
- 若需数据库回滚，可删除索引和租约列；不得改写已发布的 `0012`，应追加反向迁移。
