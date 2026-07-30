# RAG File Processing State Machine Design

## 1. Design Intent

问题不是缺少 lease SQL，而是现有正确性依赖一个 200 行函数里的局部闭包。claim、heartbeat、阶段状态、chunk transaction、错误落库和 recovery candidate 谓词无法被独立复用或审查，任何新入口都可能复制一套不完整条件。

目标是建立三个深模块：纯状态契约描述允许发生什么，repository 独占数据库如何证明所有权，coordinator 独占外部计算何时执行。调用方只提交 `fileId`，数据库记录决定 storage key、MIME、状态和 token。

## 2. Non-Negotiable Invariants

1. 只有 PostgreSQL 条件写成功才能建立或延续 owner；进程内布尔值只做快速短路。
2. token、活动状态和数据库时钟 freshness 必须同时满足，任一缺失都等价于 lease loss。
3. lease loss 后不能写阶段、error、chunks 或 terminal；晚到的外部结果只能丢弃。
4. 旧 chunks 删除、新 chunks 插入、`done/rag_ready/rag_reason` 和 lease clear 必须同一事务提交。
5. queue payload、Web 参数和 recovery snapshot 都不是文件元数据事实源；claim 返回的数据库 row 才是。
6. 原始异常不能进入数据库、console、queue rejection 或任务文档。

## 3. Target Modules

### 3.1 `processing-state.ts`

拥有：状态/阶段/结果类型、穷尽 transition command、稳定 reason/failure code、lease-loss 与 retryable domain error、统一 200 字符脱敏 formatter。

不拥有：Drizzle、timer、StorageDriver、extract/chunk/embed 调用或 queue。

状态 module 只导出有限 command，repository 不接受任意 `Record<string, unknown>` patch。新增状态必须先扩展穷尽 switch 与 transition tests，不能由调用方直接写字符串。

### 3.2 `processing-repository.ts`

拥有：

- recoverable candidates 的数据库查询；
- 原子 claim 和权威 `storagePath/mime` projection；
- owned renew 与阶段 transition；
- owned retryable failure write；
- fenced chunk replacement + terminal completion transaction。

不拥有：外部提取/embedding、heartbeat timer、错误日志或 queue ack。

repository 内部唯一构造 owned predicate：

```text
file_objects.id = lease.fileId
AND processing_lease_id = lease.token
AND processing_status IN ('extracting', 'embedding')
AND processing_lease_expires_at > <database clock expression>
```

普通 transition/renew 使用 `now()`；chunk transaction 最终 gate 使用 `statement_timestamp()`。所有 zero-row 都转成同一种 ownership-lost domain result，不把数据库细节泄漏给 coordinator。

### 3.3 `processing-coordinator.ts`

拥有：claim 后的 extract -> chunk -> embed -> persist 编排、阶段变量、heartbeat single-flight、failure classification、唯一 `processFile(fileId)` 入口和 cleanup。

不拥有：SQL predicate、candidate query、queue lifecycle、upload HTTP 或检索。

coordinator 使用 claim 返回的 canonical metadata。它不接受 `storagePath` 或 `mime`，因此 direct worker、fallback 和 recovery 无法绕过数据库事实。

### 3.4 Thin Adapters

- upload：仍负责鉴权、对象存储、pending row、queue/fallback 和固定 HTTP response；queue envelope 保持 `{fileId,storagePath,mime}` 以兼容旧 worker，fallback 调 `processFile(fileId)`。
- worker：`file-process` handler 继续接收现有 envelope，但只 await `processFile(data.fileId)`；path/mime 被丢弃，retryable generic rejection 向 pg-boss 传播。
- recovery：repository 查询候选 id，逐个调用同一 coordinator；scheduler 只拥有 single-flight、interval、per-file isolation 与 stop drain。

旧 `src/lib/rag/process.ts` 在 cutover 后删除，不保留 re-export wrapper。

## 4. State Machine

### 4.1 Primary Transitions

| Current DB fact | Command | Next DB fact | Meaning |
|---|---|---|---|
| `pending` | claim | `extracting` + fresh token/lease | 首次处理 |
| `error` | claim | `extracting` + replacement token/lease | 同一 queue job 重投或内部显式 retry |
| stale `extracting|embedding` | claim | `extracting` + replacement token/lease | 崩溃恢复，从头处理 |
| fresh active / `done` / missing | claim miss | unchanged | 并发 loser/no-op |
| `extracting` | extraction terminal | `done` + lease clear | unsupported/image/PDF/Office |
| `extracting` | extraction completed | `extracting` metadata update | 进入 chunking |
| `extracting` | chunks prepared | `embedding` | 固定 chunk count |
| `embedding` | empty text terminal | `done` + lease clear | 无可持久化文本 |
| `embedding` | embedding stage update | `embedding` | running/done/error/skipped |
| `embedding` | replace + complete | `done` + lease clear | 成功或 degraded chunks |
| active | retryable failure | `error` + lease clear | 等待 queue/显式 retry |
| active | lease loss | no write | 新 owner/未来 recovery 收敛 |

claim stale active 后总是重新进入 extracting，不尝试从部分中间阶段继续。提取和 embedding 不是可恢复 checkpoint；chunks 只有原子 terminal transaction 才是可见版本。

### 4.2 Stable Result Codes

- Terminal non-RAG：`pdf_not_supported`、`office_not_supported`、`image_skipped`、`unsupported_type`、`empty_text`。
- Degraded terminal：`embedding_unavailable`、`embedding_failed`。两者保留文本 chunks，`processing_status=done`、`rag_ready=false`。
- Retryable processing：`extraction_failed`（含 storage read）、`chunking_failed`、`persistence_failed`。`processing_status=error`，调用方收到固定无 `cause` 的通用 rejection `文件处理失败，可重试`。
- Ownership：`lease_lost` 只存在于进程内 outcome，不写 `rag_reason`，避免旧 owner 覆盖新 owner。

`rag_reason` 只保存上述稳定代码。`embed_error` 可保存脱敏、截断后的诊断消息；console 使用相同 formatter。原始 Error/cause/stack 不保存、不重新抛出。

## 5. Claim And Canonical Input

`claim(fileId)` 在一条 `UPDATE ... RETURNING` 中：

1. 匹配 `pending/error`，或 active 且 lease NULL/expired；
2. 写 `extracting`、随机 token、`now()+2 minutes`、`extract_status=running`；
3. 返回 `{ lease: {fileId, token}, storagePath, mime }`。

没有返回 row 就是正常 no-op。queue 中多余、过期或伪造的 path/mime 不参与读取；保留它们只为兼容旧 worker 和安全回滚，不形成第二事实源。

## 6. Heartbeat And Lease Loss

- claim 成功后启动 30 秒 `unref()` interval。
- 任一时刻最多一个 renew promise；tick 遇到 in-flight 直接跳过。
- renew zero-row 或数据库 reject 都设置本地 `leaseLost`，因为进程无法证明仍持有所有权。
- 每次外部调用返回后、每次 transition 前和 chunk transaction 前都检查 ownership；repository 的条件写是最终 gate。
- 所有退出路径先 clear timer，再 await 当前 renew。外部 extract/embed 无 cancellation signal，设计只承诺 fencing 晚结果。

## 7. Atomic Chunk Replacement

repository 在一个短事务中：

1. 按 file id、token 和当前 active status `SELECT ... FOR UPDATE` 锁住 parent row；
2. 拿锁后以新语句的 `statement_timestamp()` 重新校验 freshness，并从该时刻续租两分钟；
3. 删除该 fileId 的旧 chunks；
4. 每批 50 条插入新 chunks；
5. 用同 token、active status 和 `lease_expires_at > statement_timestamp()` 条件写 `done`、`ragReady`、stable reason 并清 lease；
6. zero-row 或任一 insert/DB failure 抛出，使事务整体回滚。

coordinator 只有在该方法 commit 后才把文件视为完成。事务外禁止删除/插入 `file_chunks`。

## 8. Failure Propagation

### 8.1 Terminal And Degraded Results

unsupported、image、PDF/Office 与 empty text 是正常 terminal；不 reject queue。embedding 配置不可用、provider 调用失败或返回向量数与 chunk 数不一致时，仍持久化文本 chunks 并正常 resolve，保持现有全文上下文能力和 `rag_ready` 检索门槛。

### 8.2 Retryable Processing Failure

extract/storage read、chunking 或持久化异常按当前 stage 映射 stable code。coordinator：

1. 用 owned repository write 尝试写 `error` + stable code + clear lease；
2. 若 write 因 lease loss 未命中，按 ownership no-op resolve，不记录旧 owner error；
3. 若仍拥有或 error write 本身失败，向调用方抛固定、无 cause 的 retryable domain error；
4. adapter 只记录统一脱敏短消息。

这样 worker 不会把真实处理失败确认成成功，recovery 单项仍能隔离，upload fallback 仍不阻塞 HTTP response。`error` 只允许由同一 queue job 的 transport redelivery 或明确的内部 `processFile(fileId)` 调用重试；本任务不新增公开 retry API。queue retry 次数、dead-letter 和 `error` 自动扫描留给后续 lifecycle 任务，避免无上限重试循环。

可观察安全契约逐出口固定：repository 只写 stable `rag_reason` 与最长 200 字符的安全 `embed_error`；coordinator retryable error 只有固定 message 且无 cause；worker 直接传播该 domain error；recovery、upload queue dispatch 与 sync fallback 均只记录 `redactErrorMessage(...).slice(0,200)` 的结果。

### 8.3 Error Contract Traceability

| Observable boundary | Required assertion | Owning test |
|---|---|---|
| repository DB write | `rag_reason` 仅 stable code；`embed_error` 脱敏且 <= 200 | `processing-repository.test.ts` / PG tests |
| coordinator rejection | 固定 `文件处理失败，可重试`，无 raw message、cause、stack | `processing-coordinator.test.ts` |
| worker handler | 原样 reject generic domain error，不记录 payload/path/mime | `worker.test.ts` |
| recovery candidate/scan | fileId + redacted <= 200；单项继续、SELECT 下周期重试 | `recovery.test.ts` / PG tests |
| upload queue dispatch | raw queue/DB URL/token/path 不进入 console，仍进入 fallback | `app/api/upload/route.test.ts` |
| upload sync fallback | generic coordinator failure 仅安全短日志，HTTP response 不变 | `app/api/upload/route.test.ts` |

## 9. Recovery

repository 查询保持：

```text
status = 'pending'
OR (status IN ('extracting','embedding')
    AND (lease_expires_at IS NULL OR lease_expires_at <= now()))
ORDER BY created_at, id
LIMIT 25
```

只返回 fileId。recovery 顺序 await coordinator，每项异常以 fileId + 安全短消息记录并继续；SELECT 失败向 scheduler 抛出。scheduler 立即扫描、每 60 秒触发、`inFlight` 单飞、timer unref；stop 标记 stopped、清 timer、等待 active scan。`error` 保持排除，防止没有 retry budget/backoff 时每分钟重跑永久失败文件。

## 10. Compatibility And Deployment

- HTTP：上传状态码、response body、鉴权、属主与 storage compensation 不变。
- Retrieval：只有 `rag_ready=true` 进入 RAG/KB；embedding degraded 的文本 chunks 仍可被 full-context 使用。
- Schema：无变更，无 migration/journal/snapshot，无数据清理。
- Internal queue：envelope 保持 `{fileId,storagePath,mime}`。新 worker 只消费 fileId，旧 worker 仍可消费全部三字段，因此 Web/worker 可滚动部署，积压 job 无需转换。
- 回滚：整体回滚代码即可，无 queue drain/转换和数据库 downgrade。新实现留下的 active lease 与旧实现字段语义相同，可由旧实现继续 renew，或在两分钟后重新 claim。

## 11. Rejected Alternatives

### Keep `process.ts` And Extract SQL Helpers

拒绝。helper 仍允许 coordinator、recovery 和未来入口各自拼 transition/terminal patch，无法建立唯一状态契约，也不能通过模块级 tests 证明所有写入都 fenced。

### Add A New Fencing Version Column

拒绝。随机 lease token 已在每次 claim replacement，并参与所有条件写；新增 version 不增加正确性，只增加 migration 和双条件漂移风险。

### Auto-Recover Every `error`

拒绝。当前没有 retry count、next-attempt 或 dead-letter 字段，按分钟扫描 error 会形成永久重试风暴。coordinator 先提供正确 retryable rejection，统一 policy 由下一任务实现。

### Treat Embedding Failure As Retryable `error`

拒绝。现有契约会保留文本 chunks 并允许 full-context 使用；改为 error 会改变用户可见处理状态且仍缺少有界重试策略。维持 degraded terminal 是更可靠的兼容选择。

### Keep Old Three-Argument Processing Wrapper

拒绝。processing wrapper 会继续暗示 caller-supplied path/mime 可作为事实源，并给未来代码留下绕过 canonical claim 的入口。保留 queue envelope 不等于保留 wrapper；adapter 明确丢弃冗余 metadata。

## 12. Known Risks

- queue envelope 仍携带冗余 path/mime；它们必须保持“兼容字段而非事实源”，后续删除只能在 Worker/queue lifecycle 中另做版本化 rollout 设计。
- 外部 extract/embed 不能主动取消，lease loss 只避免错误提交，仍可能浪费一次外部计算。
- embedding provider 瞬时失败仍是 degraded terminal，不自动重试；这是为保持现有行为和避免无界重试主动接受的限制。
- heartbeat renewal 的数据库调用没有可取消接口；所有出口按契约等待在途 renewal，因此底层调用永久 pending 时 `processFile` 也会一直等待。
- `processing_status` 仍是无 DB CHECK 的 text；compile-time transition union 与 repository tests 是本任务约束，未来若引入 DB enum/check 必须另做迁移规划。
