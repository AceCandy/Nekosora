# 文件处理租约恢复设计

## Problem Statement

文件处理一旦从 `pending/error` claim 成 `extracting`，进程退出便不会执行异常收敛。当前状态既没有过期边界，也没有可区分新旧执行者的 token，因此任务永久不可重试；若直接允许 stale 状态重试，又会让恢复运行的旧执行者覆盖新结果。

## Invariants

1. 同一时刻最多一个未过期租约拥有文件处理写权限。
2. 租约过期只使记录具备“可接管”资格；真正所有权仍由单条条件 UPDATE 原子确定。
3. 所有状态写入和 chunk 替换都受本次 token 保护。
4. chunk 集合与 `done` 终态原子提交，不暴露半批数据。
5. 进程退出后无需原执行者执行清理，worker 扫描最终会重新运行流水线。

## Schema

在 `file_objects` 追加：

- `processing_lease_id text NULL`：每次 claim 生成新的随机 fencing token。
- `processing_lease_expires_at timestamptz NULL`：由 PostgreSQL `now()` 计算的租约截止时间。
- 部分索引：`(processing_lease_expires_at, created_at)`，谓词为 `processing_status IN ('extracting', 'embedding')`；PostgreSQL btree 会保留 NULL 项，可同时服务 NULL/过期筛选与稳定排序。

迁移把已有活动记录的 `processing_lease_expires_at` 回填为 `now()`，使其在新 worker 启动后立即进入恢复路径；终态和 pending/error 记录保持 NULL。两个字段不设 NOT NULL 或默认值，避免旧 runtime 的普通 INSERT/UPDATE 因缺字段失败，也避免产生没有已知 token 的伪租约。

## Claim Contract

`processFile` 每次生成新 token，并执行一条条件 UPDATE：

```sql
UPDATE file_objects
SET processing_status = 'extracting',
    extract_status = 'running',
    processing_lease_id = :new_token,
    processing_lease_expires_at = now() + interval '2 minutes'
WHERE id = :file_id
  AND (
    processing_status IN ('pending', 'error')
    OR (
      processing_status IN ('extracting', 'embedding')
      AND (
        processing_lease_expires_at IS NULL
        OR processing_lease_expires_at <= now()
      )
    )
  )
RETURNING id;
```

空返回表示未获得所有权，调用者立即返回。所有后续状态更新使用同一个 owned 谓词：

```sql
id = :file_id
AND processing_lease_id = :token
AND processing_status IN ('extracting', 'embedding')
AND processing_lease_expires_at > now()
```

条件写没有返回行时抛出内部 `FileProcessingLeaseLostError`，当前执行者停止后续持久化；异常收敛也只能在仍持有有效 token 时把本行标记为 `error`。

## Heartbeat

- 租约长度为 2 分钟，续租间隔为 30 秒，与现有 run 租约窗口一致。
- heartbeat 只更新匹配 owned 谓词的记录并返回 id；无返回或数据库异常都标记本地所有权已丢失。
- timer 回调单飞：上一次续租未完成时跳过 tick，不积累未完成查询。
- timer 使用 `unref()`；所有 return/error 路径在 `finally` 中停止 timer，并等待已开始的续租完成。
- 提取和 embedding API 当前没有取消通道；租约丢失只能阻止后续数据库写入，不能声称已经取消外部操作。

## Atomic Chunk Commit

文本提取、分块和 embedding 在事务外完成，避免持有数据库锁跨越长 I/O。准备好 rows 后进入一个短事务：

1. 以 owned 谓词续租并取得 `file_objects` 行锁；失败则退出，不能操作 chunks。
2. 删除该文件旧 chunks。
3. 按 50 条分批插入新 chunks。
4. 以 `fileId + token + processing_lease_expires_at > statement_timestamp()` 把文件标记 `done`，并清空 lease 字段；无返回则抛错。
5. 统一提交；任一步异常则全部回滚。

不为 `file_chunks` 增加 generation 字段。事务开始的条件 UPDATE 会锁住 owning `file_objects` 行；stale 接管 UPDATE 必须等待该事务，提交后会因终态/新租约谓词重新判断。最终状态使用 `statement_timestamp()` 而非事务开始时固定的 `now()` 复查真实 freshness；事务耗时超过续租窗口时抛错，delete/insert/done 一并回滚。旧 token 在新执行者接管后无法通过事务首步，因此现有 chunk schema 足以实现 fencing，避免扩大迁移面。

unsupported 和 empty-text 没有 chunks 写入，使用 owned 条件直接写终态并清空 lease。普通异常只在 token 仍有效时写 `error`；已失租约时保持新执行者状态不变。

## Stale Recovery

`recoverStaleFileProcessing` 查询：

- `processing_status IN ('extracting', 'embedding')`
- `processing_lease_expires_at IS NULL OR processing_lease_expires_at <= now()`
- 按租约截止时间、创建时间稳定排序，返回 `id/storagePath/mime`
- 单轮最多 25 条并顺序调用 `processFile`；单轮未处理到的记录由后续扫描覆盖

查询不代表 claim。多个 worker 可以看到同一候选，只有 `processFile` 的条件 UPDATE 能获得新 token；其他调用 no-op。

恢复错误矩阵：

| 失败点 | 行为 |
| --- | --- |
| stale SELECT 失败 | 本轮 Promise 拒绝；调度器记录脱敏错误，worker 保持运行，下个周期重试 |
| 单个候选 claim/初始化抛错 | 记录 file id 与脱敏错误，继续同批下一候选 |
| 候选正常处理成 `error` | 保留现有 `processFile` 语义，该行不再属于 stale 活动集合 |
| 一轮超过扫描间隔 | 跳过重叠 tick，不并发启动第二轮；完成后等待下个 tick |

worker 中的调度器：

1. 所有 queue handler 注册完成后立即执行一次扫描。
2. 按固定间隔再次扫描，timer `unref()`。
3. 同一进程只允许一个扫描 Promise 在途。
4. `SIGINT/SIGTERM` 关闭先清 timer、等待 in-flight 扫描，再调用 `queue.stop()`；重复信号复用同一个 shutdown Promise。

`src/worker.ts` 导出可注入最小 process runtime 的 `startWorker`，并只在非 Vitest 入口自动启动。测试通过 mock 动态依赖和 `on/exit` 捕获信号回调，断言 handler 注册、恢复调度启动、`stopRecovery -> queue.stop -> exit` 顺序及重复信号单飞；不通过 import 测试触发真实 `process.exit`。

## Queue And Fallback Semantics

pg-boss 当前队列默认 `retryLimit=2`、`expireInSeconds=900`。handler 返回即视为完成，抛错才进入 fail/retry。若队列在租约仍有效时重投，`processFile` no-op 可能让该 job 完成；这不会再造成永久卡死，因为 worker stale 扫描是独立的最终恢复机制。Web fallback 所在进程退出后也由同一扫描路径恢复，不依赖原 Promise 的 `catch`。

本轮不改变普通处理异常的现有语义：`processFile` 仍尝试记录 `error`，不为了使用 pg-boss retry 而扩大失败策略。

pg-boss `stop()` 会停止 worker 并把 WIP job 标记失败，但本地源码没有证明它会等待已经进入 callback 的 `processFile` 返回。关闭顺序不能替代 fencing：晚返回的 handler 仍必须通过 token + fresh lease 条件写，失去租约后不得修改状态或 chunks。

## Verification Strategy

Vitest mock 测试用于穷举每个状态分支、timer 单飞和 worker 信号顺序；不能用这些测试证明 PostgreSQL 行锁或事务隔离。

真实数据库门禁由仓库脚本 `scripts/test-file-processing-lease-pg.ts` 统一执行，使用项目 `DATABASE_URL` 作为仅限管理连接的来源：

1. 生成仅含固定前缀与随机十六进制后缀的唯一数据库名；脚本自身构造 `TEST_DATABASE_URL`，不接受调用方指向任意数据库。
2. 创建临时数据库并在其上执行完整 Drizzle migrations。
3. 运行 PG 集成测试，覆盖两个连接并发 claim 只有一胜者、旧 token 条件 UPDATE 为零行、chunk 事务持有父行锁时 stale claim 等待并在提交后重新判定、最终 freshness 失败与插入失败时 delete/insert/done 全部回滚。
4. `finally` 中先关闭测试连接/子进程，再由管理连接终止仅该随机库的残留 session 并 `DROP DATABASE`；清理目标必须再次通过固定前缀校验。

脚本不输出管理或测试连接串。若临时数据库创建、迁移、测试或清理任一步失败，本轮门禁失败，不能把 mock 测试通过报告为并发验收完成。

## Compatibility, Rollout, Rollback

### Rollout

1. 应用 PostgreSQL 迁移。
2. 停止接收新任务并排空/停止旧 worker 与可能运行 fallback 的旧 Web 实例。
3. 启动新 Web 和新 worker；新 worker 首轮扫描接管迁移回填的遗留活动行。

nullable 字段保证旧代码不会因 schema 变化直接报错，但不能保证旧执行者接受 fencing。新扫描器不得与仍可能写入 chunks 的旧 runtime 混部；这是正确性约束，不以“滚动兼容”名义弱化。

### Rollback

- 代码可以回滚而保留 nullable 字段和部分索引。
- 回滚前先停止新 worker并等待活动租约完成；若仍有活动租约，需继续运行新 worker恢复，或显式把确认无执行者的记录重置为 `error` 后再启旧 worker。
- 不回退/改写已执行的迁移；后续如需删除字段必须追加迁移。

## Risks And Mitigations

- 进程长时间暂停：租约到期后旧执行者会被 fenced；其计算可能浪费，但不能污染数据。
- 临时数据库故障：heartbeat 失败后保守停止后续写，等待扫描重做，优先正确性而非避免重复计算。
- stale backlog：单轮限制避免一次扫描无界占用内存；周期扫描最终覆盖剩余记录。
- 多 worker：扫描可能重复读取，但 claim CAS 保证唯一执行。
