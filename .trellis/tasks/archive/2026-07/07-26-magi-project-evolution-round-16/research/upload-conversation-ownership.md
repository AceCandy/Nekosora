# Upload Conversation Ownership Research

## Confirmed Data Flow

```text
authenticated user
  -> multipart conversationId supplied by client
  -> storage.put under authenticated user's storage key
  -> insert file_objects
       user_id = authenticated user
       conversation_id = unvalidated client value
  -> queue or synchronous file processing
```

- `src/app/api/upload/route.ts:39-63` 校验 session、multipart、file 和大小，但没有验证 `conversationId`。
- `src/app/api/upload/route.ts:65-73` 在任何会话查询前读取文件并调用 StorageDriver。
- `src/app/api/upload/route.ts:75-88` 直接把客户端 ID 写入 `file_objects.conversationId`。
- `src/db/schema/pg.ts:555-564` 的普通 FK 只阻止不存在的会话 ID，不约束文件 owner 与会话 owner 一致。
- `src/app/api/upload/route.test.ts:51-263` 覆盖大小限制、合法上传、存储/DB/队列失败和文件名清洗，但没有 foreign、missing、owned 或 empty 会话授权矩阵。

## Root Cause

上传路由只把 session 用于生成用户隔离的存储 key 和 `file_objects.userId`，却把同一请求中的关系字段 `conversationId` 当作可信引用。数据库外键被误当成了授权约束，但外键只能回答“目标是否存在”，不能回答“当前主体是否拥有目标”。

这是一个关系完整性与对象级授权缺口。当前没有生产路径按 `fileObjects.conversationId` 返回文件内容，因此已证实的影响是让攻击者创建 `file.userId = attacker`、`file.conversationId = victimConversation` 的跨用户关系；没有证据支持直接文件泄露结论。

## Required Authorization Predicate

非空关联必须用单次组合查询验证：

```text
conversations.id = submitted conversationId
AND conversations.userId = authenticated user id
```

空结果既可能表示不存在，也可能表示不属于当前用户；两者统一返回 403 和“会话不存在或无权访问”。该方式不会把 foreign 会话行取回应用层，也避免通过响应暴露目标存在性。

空字符串是既有的“无会话关联”输入，应跳过查询并写 `null`。

## Side-Effect Boundary

拒绝必须发生在以下操作之前：

- `getStorage` 与 `storage.put`
- `db.insert(fileObjects)`
- `getQueue` 与 `queue.send`
- `processFile` fallback

因此 `getDb`/`getSchema` 必须从存储写入之后前移到文件校验之后。查询或数据库获取异常自然发生在零存储副作用阶段。文件插入仍在存储之后，继续使用现有 `storage.delete` 补偿。

## Minimal Fix

- 在路由中直接使用 `drizzle-orm` 的 `and` 与 `eq`。
- 获取一次 db/schema，授权查询与文件插入复用。
- 非空 ID 查询会话 ID；空结果立即返回统一 403。
- 保留 `conversationId || null`、存储补偿和队列 fallback。
- 不引入事务/行锁或共享 helper。

## Alternatives Considered

- **按 ID 查询后比较 owner**：能够修复，但会把 foreign 行取回应用层，且查询本身没有表达授权边界；组合条件更直接。
- **`withConversationMessageWrite`**：提供事务和行锁，但上传不写会话消息，额外锁定会扩大争用与概念边界。
- **复合外键**：能强化全局数据约束，但需要键设计、迁移和历史数据治理；不适合作为本轮入口漏洞的最小修复。
- **共享授权 helper**：当前只有一个新增调用点，没有足够重复支撑抽象。

## Pre-Fix Coverage Gap

需要通过公开 `POST` handler 建立以下矩阵：

| Input | Query | Response | Persisted relation | Side effects on rejection |
|---|---|---|---|---|
| owned ID | id AND current user | 200 | submitted ID | normal upload |
| foreign ID | id AND current user -> empty | 403 | none | none |
| missing ID | id AND current user -> empty | 403 | none | none |
| empty ID | skipped | 200 | null | normal upload |

修复前 foreign ID 会走完整上传流程；missing ID 可能在外键插入时失败，但此前已经写入存储并依赖补偿，且响应不是统一授权拒绝。

## Deferred Candidates

- 历史跨用户 `file_objects` 关系的扫描与清理需要单独的数据修复策略。
- `conversations.generating` 并发误清需要 run token/CAS、计数器或 active-runs 数据模型。
- Embedding Provider 多实例缓存失效需要重新决定缓存生命周期与跨进程一致性。
- 后台 consumer 重试需要幂等、错误分类、backoff 和永久失败语义。
- 非流式 `generateChat` 参数不对称当前没有高影响真实调用方。

这些候选保持独立，避免把 schema、缓存或 worker 可靠性设计混入本轮小范围授权修复。

## Break-Loop Analysis

### 1. Root Cause Category

- **Category**：B - Cross-Layer Contract，伴随 D - Test Coverage Gap 与 E - Implicit Assumption。
- **Specific Cause**：上传入口把 session 鉴权用于文件 owner，却没有把客户端关系 ID 映射为 `conversation.id + conversation.userId` 的对象级授权谓词；普通 FK 的存在性约束被隐式当成了属主约束。
- **Evidence**：修复前公开 `POST` 回归测试稳定观察到 foreign ID 返回 200 并触达完整上传链；加入组合查询后，同一测试返回统一 403，且 storage、insert、queue 和 fallback 调用均为零。对根因判断置信度高于 95%。

### 2. Why Earlier Protection Was Incomplete

1. session 鉴权只证明调用者身份，无法证明请求体中的 `conversationId` 属于该调用者。
2. `file_objects.conversation_id` 外键只验证目标存在，无法表达两张表的 `user_id` 必须一致。
3. 既有路由测试集中覆盖上传大小、存储补偿、队列 fallback 与文件名清洗，没有 owned/foreign/missing/empty 关系授权矩阵。
4. 存储补偿降低了 DB 失败后的残留风险，但它不能替代副作用前授权；继续依赖补偿会先接受并处理本应拒绝的请求。

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | 在 `/api/upload` 用 ID + owner 组合谓词校验非空会话关联，并在所有上传副作用前拒绝。 | DONE |
| P0 | Test Coverage | 通过公开 handler 覆盖 owned、foreign、missing、empty、查询异常与副作用断言。 | DONE |
| P0 | Documentation | 在 `backend/file-storage.md` 增加七节关联授权契约，并修订 DB 预检/存储补偿顺序。 | DONE |
| P1 | Review | 审查客户端关系 ID 时逐项核对 owner/visibility 谓词、missing/foreign 等价响应和副作用边界。 | DONE |

### 4. Systematic Expansion

- **Similar Issues**：所有接受 file ID、knowledge-base ID、conversation ID 或其他关系 ID 的入口都应按调用者 owner/visibility 查询；既有 `User-Owned RAG And Vision Files` 契约已覆盖文件读取侧，本轮补齐上传关系写入侧。
- **Design Improvement**：把“目标存在”与“调用者可关联目标”视为两个独立约束；应用查询负责授权，外键继续负责并发删除和最终引用完整性。
- **Process Improvement**：资源关系接口的回归矩阵必须同时包含 owned、foreign、missing、empty，并断言拒绝发生在存储、写库、网络、缓存和任务调度之前。

### 5. Knowledge Capture

- [x] `backend/file-storage.md` 已记录完整可执行契约与错误矩阵。
- [x] `cross-layer-thinking-guide.md` 已有“UI Filtering Is Treated As Resource Authorization”规则，无需重复追加同义内容。
- [x] `route.test.ts` 已通过公开入口建立组合 owner 谓词与零副作用回归。
- [x] 本轮未新增独立 issue；历史数据清理由 Out Of Scope 明确延后。
