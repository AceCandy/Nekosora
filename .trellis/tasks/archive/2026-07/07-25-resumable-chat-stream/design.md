# Design: P2-B 可恢复 SSE 与请求幂等

## 0. 边界与原则

### 0.1 设计边界

| 在范围内 | 不在范围内 |
|---------|-----------|
| WebChat `POST /api/chat` 链路 | 网关 `/v1/chat/completions` 可恢复流 |
| run 事件日志 + 幂等 + 重放/附着 API | Pi AgentHarness |
| 分阶段 A/B 架构与灰度 | 改 `model_catalog` 事实源 |
| 前端 store/SSE 恢复契约 | 跨区域 exactly-once |
| 基于现有 pg-boss worker 的 B 阶段执行器 | 用 events 替换 messages 对话树 |

### 0.2 核心原则

1. **A/B 不可伪装**：接口与 UI 语义必须让调用方区分「只重放已发生」与「后台仍在生成」。
2. **messages 仍是对话树真相**；`run_events` 是单次 run 的时序日志，用于恢复 UI，不替代 branch 树。
3. **写放大可控**：高频 delta 合并落库；敏感字段走 `toSafeJsonb`；payload 有硬上限。
4. **旧客户端兼容**：无 `idempotencyKey` / 不识别 `id:` 时行为与今日一致（断线即 abort 上游）。
5. **渐进发布**：schema → 幂等 → A 重放 → 前端 → B 解耦；每步可回滚。

### 0.3 今日基线（实现锚点）

```
POST /api/chat
  auth + owner check
  createRunId()                         # run_xxx
  insert user (send only, with runId)
  prepareChatContext()
  conversations.generating = true
  startRun(status=running)
  ReadableStream.start:
    emit user_message / assistant_message / search / rag / compact / trace
    for await streamChat{WithTools}:
      text-delta | reasoning | tool-* | finish | error  → data: {...}\n\n
    finally:
      insert/update assistant (success|interrupted)
      artifacts / generating=false / memory-extract enqueue
      finalizeRun(success|failed|interrupted)
      data: [DONE]
  cancel()/req.abort → abortCtl.abort()  # 上游停止
```

前端：`fetch` + `AbortController` + `consumeChatSSE`（只认 `data:`）+ zustand `runtimes[conversationId]`。

---

## 1. 阶段 A / 阶段 B

### 1.1 定义

```
阶段 A — Request-bound + Durable events
──────────────────────────────────────
  浏览器连接 ──绑定──► Next.js 请求处理器 ──► 上游模型
       │                     │
       │              append run_events
       │                     │
       └──断线──► abort 上游 ──► finally 落 messages + terminal
  重连 = 只读重放 events / 读 messages，不保证新 token

阶段 B — Decoupled producer
──────────────────────────────────────
  浏览器 ──create/attach──► API
                              │
                         enqueue / claim run
                              │
                         worker/executor ──► 上游模型
                              │
                         append run_events (持续)
                              │
  浏览器 ──SSE attach after=seq──► 读 events 直到 terminal
  断线 不 abort 生产者；stop API 才 abort
```

### 1.2 能力承诺矩阵

| 场景 | 阶段 A | 阶段 B |
|------|--------|--------|
| 弱网丢包后自动重连 | 重放已落库事件；若 run 已因 abort 结束 → interrupted + 部分正文 | 重放 + 继续收后续事件 |
| 刷新页面 | 从 DB messages/events 恢复已落库内容 | 同左；若仍 streaming 则 attach |
| 关闭标签后模型继续 | **否** | **是** |
| 主动 Stop | `abort` 当前 fetch（今日行为） | `POST .../stop` + 本地 abort attach |
| 幂等防双发 | 是（I2 起） | 是 |
| 产品文案 | 「恢复已生成内容」 | 「后台继续生成」 |

### 1.3 伪装禁止（验收红线）

- 阶段 A 的 status 查询若 `streaming` 但 lease/执行者已死，必须在 stuck 检测后收敛为 `interrupted`，不得长期显示「生成中」。
- 前端不得在 A 模式显示「后台生成中」类文案；仅 `run.mode === "detached"`（B）才可。
- Feature flag：`chat.resumable_sse`（A）、`chat.detached_run`（B）。B 依赖 A；B off 时即使有 worker 也不 detach。

---

## 2. 事件契约

### 2.1 TypeScript 类型

```typescript
/** 与 SSE / DB / 前端 reducer 共用的事件类型。 */
export type ChatRunEventType =
  | "run_started"
  | "user_message"
  | "assistant_message"
  | "delta"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "search_result"
  | "rag_search"
  | "compact"
  | "trace"
  | "finish"
  | "error"
  | "title_updated" // 可选；标题任务异步，可不进 run 关键路径
  | "run_terminal"  // status + 摘要；terminal 的权威信号之一
  | "done";         // 等价于今日 data: [DONE]

export interface ChatRunEventEnvelope {
  runId: string;
  /** 同一 run 内从 1 起严格单调递增。 */
  seq: number;
  /** 建议 `${runId}:${seq}`，同时作为 SSE id: 字段。 */
  eventId: string;
  type: ChatRunEventType;
  /** 有界、已脱敏的 JSON 对象。 */
  payload: Record<string, unknown>;
  /** ISO-8601 UTC。 */
  createdAt: string;
}

/** 各 type 的 payload 形状（实现期用 zod 校验边界）。 */
export type ChatRunEventPayloadMap = {
  run_started: {
    conversationId: string;
    mode: "request_bound" | "detached";
    assistantPublicId: string;
    userPublicId?: string;
  };
  user_message: { publicId: string };
  assistant_message: { publicId: string };
  delta: { text: string }; // 合并后的增量，非必逐 token
  reasoning: { text: string };
  tool_call: { toolCallId: string; toolName: string; args?: unknown };
  tool_result: { toolCallId: string; toolName: string; isError: boolean };
  search_result: { results: { title: string; url: string; snippet: string }[] };
  rag_search: { status: unknown };
  compact: { strategy?: string; level?: unknown };
  trace: { trace: unknown };
  finish: { usage?: unknown };
  error: { error: string; code?: string };
  run_terminal: {
    status: "success" | "failed" | "interrupted";
    messageStatus?: "success" | "interrupted";
    assistantPublicId?: string;
  };
  done: Record<string, never>;
  title_updated: { title: string; conversationId: string };
};
```

### 2.2 SSE 帧格式

```
id: run_01H...:12
event: message
data: {"runId":"run_01H...","seq":12,"eventId":"run_01H...:12","type":"delta","payload":{"text":"你好"},"createdAt":"2026-07-25T12:00:00.000Z"}

```

规则：

1. 每个可恢复事件必须有 `id:`；`eventId === id`。
2. 兼容旧客户端：仍可用裸 `data: {"type":"delta","text":"..."}` **过渡期双写**（见 §6.4）；新客户端只认信封。
3. 终结：
   - 优先发 `type=run_terminal`（seq=N）→ `type=done`（seq=N+1）→ 可选保留字面 `data: [DONE]`（无 id，不入库）以兼容旧 `consumeChatSSE`。
4. `[DONE]` **不替代** `run_terminal`：DB 真相以 `runs.status ∈ terminal` 与 `run_terminal` 事件为准。

### 2.3 顺序、唯一与重放

```
appendEvent(runId, type, payload):
  BEGIN
    UPDATE runs SET last_seq = last_seq + 1
      WHERE run_id = :runId
      RETURNING last_seq AS seq
    INSERT run_events(run_id, seq, event_id, type, payload)
      VALUES (:runId, seq, :runId||':'||seq, type, payload)
  COMMIT
  return envelope
```

- 唯一约束：`UNIQUE(run_id, seq)`、`UNIQUE(event_id)`。
- 重放：`WHERE run_id=? AND seq > :after ORDER BY seq ASC LIMIT :limit`。
- 客户端：仅应用 `seq > lastAppliedSeq`；乱序丢弃或缓冲（服务端保证有序推送，重放有序）。

### 2.4 高频 delta 策略（控写放大）

| 事件 | 落库策略 |
|------|---------|
| run_started / user_message / assistant_message / tool_* / finish / error / run_terminal / done | **同步**落库后推送 |
| trace / search_result / rag / compact | 同步（低频） |
| delta / reasoning | **合并窗口**：默认 50ms 或累计 ≥256 字符，取先到者 flush；流结束 force flush |

可选优化（非首发必须）：周期性 `assistant_snapshot`（全量正文哈希 + 长度），重放时可用 snapshot 加速；首发用「合并 delta + 最终 messages.content」即可。

### 2.5 `[DONE]` 与 terminal 关系

```
成功路径:
  ... deltas ...
  finish (optional, 带 usage)
  persist messages.status=success
  finalizeRun(success)
  run_terminal{status:success}
  done
  data: [DONE]   # 兼容

中断路径 (A: 客户端断开):
  abort upstream
  persist messages.status=interrupted (部分 content)
  finalizeRun(interrupted)
  run_terminal{status:interrupted}
  done            # 若连接仍半开可推；已断开则仅落库
  # 无 [DONE] 到客户端也可：重连靠 run_terminal

失败路径:
  error 事件
  messages interrupted 或保留空 assistant 策略见失败矩阵
  finalizeRun(failed)
  run_terminal{status:failed}
  done
```

**不变式**：`done` / `[DONE]` 出现前，assistant 必要持久化与 `runs.status` 终态更新必须已完成（延续今日「DONE 是可靠完成信号」语义，并扩展到 terminal 事件）。

---

## 3. 幂等

### 3.1 客户端键生成

```typescript
// 每次用户意图创建一次；重试网络用同一 key，用户再次点击发送用新 key
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// 意图维度（写入请求体）
interface ChatPostIdempotency {
  idempotencyKey: string; // 或 requestId，二选一字段名：推荐 idempotencyKey
}
```

绑定时机：

| 操作 | 何时 new key |
|------|----------------|
| send | 用户点发送时 |
| regenerate | 点重试时 |
| editAndResend | 确认编辑发送时 |
| continueGeneration | 点继续时 |
| 自动网络重试同一意图 | **复用** key |

### 3.2 请求指纹

对稳定字段做 canonical JSON → sha256：

```typescript
interface IdempotentChatBodyFingerprint {
  conversationId: string;
  model: string;
  modelId?: string;
  // 意图类型
  intent: "send" | "retry" | "edit" | "continue";
  userPublicId?: string;
  parentPublicId?: string;
  sourcePublicId?: string;
  continueFromPublicId?: string;
  // 内容：send/edit 取最后 user 文本；retry/continue 可不含全文而用 publicId
  contentHash?: string; // sha256(user text) for send/edit
  fileIds?: string[];
  webSearch?: boolean;
  knowledgeBaseIds?: string[];
  templateId?: string;
  instructionCardIds?: string[];
}
```

**不要**把整份 `messages[]` 历史塞进指纹（体积大且易抖）；以 intent + 相关 publicId + contentHash 为准。

### 3.3 服务端行为

```
POST /api/chat + idempotencyKey
  scope = (userId, conversationId, idempotencyKey)

  existing = findRun(scope)
  if existing:
    if existing.request_fingerprint != fingerprint:
      return 409 { code: "idempotency_conflict", runId: existing.runId }
    // 同指纹：不重复执行，统一返回已有 run 描述
    return I2:  200 { resumed: true, runId, status, mode }
           I3+: 200 { resumed: true, runId, status, mode, streamUrl }

  // 新 key：事务内
  insert run (queued/preparing, idempotency_key, fingerprint)
  insert user message if send
  ... 进入生成
```

唯一约束（推荐 partial unique）：

```sql
CREATE UNIQUE INDEX runs_user_conv_idempotency_uidx
  ON runs (user_id, conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

并发双 POST：第二事务 unique 冲突 → 再读已有行 → 走附着/409 分支。

### 3.4 防重复 user / assistant / run

| 实体 | 策略 |
|------|------|
| run | 唯一 (user, conv, idempotency_key) |
| user message | 仅首个受理者 insert；附着路径跳过 |
| assistant | 创建 run 时预分配 `assistantPublicId` 写入 run 元数据；insert 用固定 publicId，冲突则忽略 |
| tool_calls | 已有 (runId, toolCallId) 更新语义，保持 |

无 `idempotencyKey`：保持今日每次 `createRunId()` 行为（旧客户端）。

---

## 4. 数据模型

### 4.1 `runs` 扩展（草案）

```sql
-- 现状: status text default 'running'; 无幂等/租约/seq
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS intent text,              -- send|retry|edit|continue
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'request_bound',
    -- request_bound | detached
  ADD COLUMN IF NOT EXISTS last_seq integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assistant_public_id text,
  ADD COLUMN IF NOT EXISTS user_public_id text,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS terminal_reason text;

-- 状态迁移：running → streaming（读路径兼容二者）
-- 目标枚举语义（仍可用 text 列 + 应用层校验，或新建 pgEnum）
-- queued | preparing | streaming | waiting_tool | success | failed | interrupted

CREATE UNIQUE INDEX IF NOT EXISTS runs_user_conv_idempotency_uidx
  ON runs (user_id, conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS runs_conv_status_idx
  ON runs (conversation_id, status);

CREATE INDEX IF NOT EXISTS runs_lease_idx
  ON runs (lease_expires_at)
  WHERE status IN ('queued','preparing','streaming','waiting_tool');
```

`generating`：**短期保留** boolean，由「是否存在该会话非终态 run」驱动写入，避免侧栏大改。中期可改为查询派生，但非本任务必须。

### 4.2 `run_events`（草案）

```sql
CREATE TABLE IF NOT EXISTS run_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  seq integer NOT NULL,
  event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_events_run_seq_unique UNIQUE (run_id, seq),
  CONSTRAINT run_events_event_id_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS run_events_run_seq_idx
  ON run_events (run_id, seq);

CREATE INDEX IF NOT EXISTS run_events_created_idx
  ON run_events (created_at);
```

Drizzle 对应放在 `src/db/schema/pg.ts`；迁移 `drizzle/pg/00xx_*.sql` + journal/snapshot **同 PR**。

### 4.3 Payload 上限与脱敏

| 规则 | 值 |
|------|-----|
| 单事件 payload JSON 序列化上限 | **16 KiB**（超限截断 + `truncated:true` + `sha256`） |
| 单 run events 行数软上限 | 例如 50_000；超限停止写 delta，仅保 terminal |
| 敏感 key | 复用 `run-lifecycle` 的 `SENSITIVE_KEY_RE` + `toSafeJsonb` |
| **禁止** | 完整 system prompt、完整 IR messages 历史、Authorization、apiKey、原始 upstream 请求体 |
| delta/reasoning | 只存增量文本；可不存全量重复 |
| tool args/result | 与 tool_calls 表一致：安全 jsonb；事件里可只存 toolCallId+name+isError，大 args 以 tool_calls 为准 |
| trace | 已是摘要结构，可存；若过大则只存 tokenEstimate 等标量 |

### 4.4 保留期与清理

| 数据 | 保留 | 清理 |
|------|------|------|
| 非终态 run events | 跟随 run | run 终态后按策略 |
| 终态 run events | **7 天**默认（可配置 `chat.run_events_ttl_days`） | pg-boss 定时 job 或 bootstrap 附带批删 |
| runs 行 | 长期（审计/关联 messages.runId） | 可不删；可剥离开 events |
| 级联 | 删 conversation → runs cascade → events cascade | 已有 FK 思路 |

清理 SQL 示意：

```sql
DELETE FROM run_events e
USING runs r
WHERE e.run_id = r.run_id
  AND r.status IN ('success','failed','interrupted')
  AND r.finished_at < now() - interval '7 days';
```

---

## 5. 状态机

### 5.1 状态与含义

| 状态 | 含义 |
|------|------|
| `queued` | 已接受（幂等创建成功），等待执行器（B）；A 可瞬间经过 |
| `preparing` | `prepareChatContext` / MCP resolve 等 |
| `streaming` | 正在收模型 token（今日 `running` 映射到此） |
| `waiting_tool` | agent loop 等待工具结果 |
| `success` | 正常 finish + 持久化完成 |
| `failed` | 流错误/异常且非用户 abort |
| `interrupted` | 用户 stop / 客户端断开(A) / 超时 / maxSteps 无 finish |

### 5.2 合法转换

```
                    ┌──────────────┐
                    │    queued    │
                    └──────┬───────┘
                           │ claim / start
                           v
                    ┌──────────────┐
            ┌───────│  preparing   │───────┐
            │       └──────┬───────┘       │
     fail/abort            │ ready         │ fail/abort
            │              v               │
            │       ┌──────────────┐       │
            │       │  streaming   │◄──┐   │
            │       └──┬───┬───┬───┘   │   │
            │          │   │   │       │   │
            │    tool  │   │   │ finish│   │
            │          v   │   │       │   │
            │  waiting_tool┘   │       │   │
            │      │           │       │   │
            │      └───────────┘       │   │
            v          abort/timeout   v   v
     ┌──────────┐   ┌─────────────┐  ┌─────────┐
     │  failed  │   │ interrupted │  │ success │
     └──────────┘   └─────────────┘  └─────────┘
            └──────── terminal（不可再转非终态）────────┘
```

应用层：`finalizeRun` 仅当 `status NOT IN terminal` 时更新（延续今日「只更新 running」的思想，扩展为非终态集合）。

### 5.3 与今日映射

| 今日 | 目标 |
|------|------|
| `running` | `streaming`（读兼容：`IN ('running','streaming')` 视为活跃） |
| `success` / `failed` / `interrupted` | 同名 |
| 无 queued/preparing/waiting_tool | 新增；旧行无这些值 |

迁移：不必改写历史 `running` 行；bootstrap 把僵尸 `running/streaming/...` 收敛为 `interrupted`。

### 5.4 崩溃恢复 / 超时 / abort

| 事件 | 阶段 A | 阶段 B |
|------|--------|--------|
| 进程崩溃 | bootstrap：`generating=false`；非终态 run → `interrupted` + 可选 `run_terminal` 补写 | lease 过期后可 reclaim **或** 标 interrupted（首发 B 建议：过期 → interrupted，避免双跑；后续再做 exactly-once resume 上游，通常做不到） |
| 上游不可恢复 | `failed` | 同 |
| 客户端断开 | abort 上游 → `interrupted` | **不** abort；仅 detach 消费者 |
| 用户 Stop | abort → `interrupted` | stop API：abort 执行器 → `interrupted` |
| 工具超时 | tool failed + 继续或中断（沿用 agent loop） | 同，状态可短暂 `waiting_tool` |
| stuck 检测 | `heartbeat_at`/`updated` 超过 T（如 2min 无事件且非 waiting_tool）→ interrupted | 同 + lease 续期失败 |

**重要**：LLM 上游本身通常不可从中途 token 续跑；B 的「继续生成」是指**连接断开后执行器不中断**，不是「从 half-output 向同一 completion 续 TCP」。若执行器进程死亡，只能 interrupted 或**新 run**（产品层「继续生成」已有 continue API）。

### 5.5 多实例与租约（B）

```
claim(runId, workerId, leaseSec=30):
  UPDATE runs SET
    lease_owner=workerId,
    lease_expires_at=now()+leaseSec,
    heartbeat_at=now(),
    status=preparing
  WHERE run_id=runId
    AND status='queued'
    AND (lease_owner IS NULL OR lease_expires_at < now())
  RETURNING *

heartbeat: 周期性续租
release on terminal
```

单实例 A 模式：可不写 lease；`mode=request_bound` 时 lease 可空。

---

## 6. API

### 6.1 端点一览

| 方法 | 路径 | 作用 | 阶段 |
|------|------|------|------|
| `POST` | `/api/chat` | 创建 run（或幂等附着）并开始/返回流 | A/B |
| `GET` | `/api/chat/runs/[runId]` | 状态查询 | A/B |
| `GET` | `/api/chat/runs/[runId]/events?after=&limit=` | 事件重放（JSON） | A/B |
| `GET` | `/api/chat/runs/[runId]/stream?after=` | SSE 附着（重放缺口后挂直播） | A 有限 / B 完整 |
| `POST` | `/api/chat/runs/[runId]/stop` | 主动停止 | A/B |

均需 `getSession()`；并校验 `runs.userId === user.id` 且 conversation 属主（防 runId 枚举）。

### 6.2 POST /api/chat 响应形态

**兼容模式（无 flag / 旧客户端）**：今日 SSE 直接开始。

**可恢复模式**（请求头 `X-Chat-Resumable: 1` 或 body `resumable: true`）：

选项 1（推荐，少一轮 RTT）：仍直接 SSE，但：

- 首帧 `run_started` 含 `runId`
- 每帧带 `id:`
- 响应头：`X-Run-Id: run_...`

选项 2：`202 { runId, streamUrl }` 再 GET stream（B 更自然）。

**决策**：A 首发用选项 1。B 的 `mode=detached` 固定使用选项 2，返回
`202 { runId, status: "queued", mode: "detached", streamUrl }`，客户端随后 GET attach；不在 POST 响应内复用 request-bound 流。

幂等同 key + 同指纹命中时，无论 run 是否终态都不得再次执行。I2 固定返回
`200 { resumed: true, runId, status, mode }`；I3 起固定返回
`200 { resumed: true, runId, status, mode, streamUrl }`。终态由客户端刷新 messages，非终态由客户端 attach `streamUrl`。

### 6.3 重放与附着

```
GET events?after=10&limit=500
→ { runId, status, lastSeq, events: Envelope[] }

GET stream?after=10
→ SSE:
   1) 重放 seq>10 的历史（带 id）
   2) 若仍非终态：阻塞读新 events（LISTEN/NOTIFY 或轮询 DB）
   3) 见到 done/terminal 后关闭
```

阶段 A：若 POST 连接已 abort，run 很快终态，GET stream 仅重放历史。

### 6.4 兼容与灰度

| 开关 | 默认 | 效果 |
|------|------|------|
| `chat.resumable_sse` | off→on 灰度 | 写 events + SSE id；旧客户端忽略 id |
| `chat.idempotency` | on 当客户端传 key | 服务端启用幂等分支 |
| `chat.detached_run` | off | B 执行器 |

双写过渡（最长 1–2 个版本）：

```json
// data 内同时提供扁平字段与信封，旧 consumeChatSSE 仍可读 type/text
{
  "type": "delta",
  "text": "你好",
  "runId": "...",
  "seq": 12,
  "eventId": "...",
  "payload": { "text": "你好" },
  "createdAt": "..."
}
```

新前端迁到只读信封后去掉扁平字段。

### 6.5 鉴权失败矩阵（摘录）

| 条件 | HTTP |
|------|------|
| 未登录 | 401 |
| run 不存在或不属于用户 | 404（防枚举，不暴露存在性可统一 404） |
| conversation 不属主 | 403/404 |
| 幂等冲突 | 409 |
| 非法 after/seq | 400 |

---

## 7. 前端

### 7.1 Runtime 扩展

```typescript
interface ConversationRuntime {
  messages: ChatMessage[];
  streaming: boolean;
  abortController: AbortController | null;
  // 新增
  activeRunId?: string;
  lastSeq?: number;
  runMode?: "request_bound" | "detached";
  reconnectAttempt?: number;
  idempotencyKey?: string;
}
```

### 7.2 Reducer 规则（seq 去重）

```
onEnvelope(env):
  if env.seq <= runtime.lastSeq: drop (metric: duplicate)
  if env.seq > lastSeq+1: 暂停应用，按 after=lastSeq 请求 events 填洞
  if 重放后仍缺号或 run.terminalReason=event_persistence_failed:
    停止拼接 delta，刷新 messages + run status
  switch env.type:
    delta → enqueueDelta(publicId 定位的消息)
    tool_call → 按 toolCallId 追加/更新 toolCalls（保留已有）
    ...
    run_terminal → 设 message.status；streaming=false
    done → flushDeltasNow；streaming=false
  lastSeq = env.seq
```

**避免重复 delta**：

- 重连前记录 `lastSeq`；只请求 `after=lastSeq`。
- hydrate 自 SSR 的 messages 已是落库全文时：若重放 delta 会导致重复，则策略为：
  - **优先**：重连只用于仍 `streaming` 的 run；已终态则 `listMessages` 刷新，不重放 delta。
  - 或：本地维护 `contentLengthApplied`，snapshot/终态消息用绝对 content 覆盖而非追加。

### 7.3 重连退避

```
attempt 0: immediate
delay = min(1000 * 2^attempt, 15000) + jitter
maxAttempts: request_bound 3；detached 无限直到 terminal 或用户离开会话页卸载策略另定
```

触发：`fetch` network error、SSE reader 异常、非 abort 的中断。用户 `stopGeneration` 不重连。

### 7.4 切会话 / 版本 / 反馈 / toolCalls

- 现有 `runtimes` 多会话隔离保持；切走不 abort（今日已是）。
- `switchVersion` / `feedback` / `toolCalls` 以 `publicId` 为键合并，恢复事件不得清空未出现在事件里的字段。
- SSR hydrate：若 `generating` 或存在活跃 run，前端 mount 时 `GET run status` + 条件 attach。

### 7.5 与 `consumeChatSSE` 演进

1. 扩展解析：`id:` 行 + 信封 JSON。
2. 保留 `[DONE]` 与扁平 `type` 兼容。
3. 单测：乱序/重复 seq、半包、重连 after。

---

## 8. 可观测性 / SLO

### 8.1 指标（Prometheus 扩展建议）

| 指标 | 类型 | 标签 |
|------|------|------|
| `nekusora_chat_run_resume_total` | Counter | result=success\|fail\|noop |
| `nekusora_chat_run_duplicate_event_total` | Counter | source=client\|server |
| `nekusora_chat_run_disconnect_total` | Counter | phase=a\|b |
| `nekusora_chat_run_stuck_total` | Counter | status |
| `nekusora_chat_ttft_ms` | Histogram | mode |
| `nekusora_chat_event_persist_ms` | Histogram | type |
| `nekusora_chat_run_queue_delay_ms` | Histogram | （B） |

沿用现有 `activeStreams` / `requestDurationMs` / `logUsage` TTFT。

### 8.2 SLO 目标（初值，可调）

| 项 | 目标 |
|----|------|
| A：断线后 30s 内可重放已落库前缀 | ≥ 99% |
| 重复应用事件率（客户端） | < 0.1% |
| event 同步持久化 P99（非 delta 合并路径） | < 50ms |
| B：enqueue→preparing P99 | < 2s |
| stuck run（>5min 非终态） | 告警 |

### 8.3 日志

- 只记 `runId/seq/type/op`，不记 payload 全文。
- 失败：`[run-events] append failed: ...` 短消息（对齐 run-lifecycle）。

---

## 9. 端到端流程（ASCII）

### 9.1 阶段 A：正常完成

```
Client                     POST /api/chat                      DB / Upstream
  |-- idemKey, body ------->|                                    |
  |                         |-- insert run preparing ----------->|
  |                         |-- insert user -------------------->|
  |                         |-- generating=true ---------------->|
  |                         |-- prepare + streamChat ----------->|
  |                         |-- append events + SSE id --------->|
  |<----- SSE envelopes ----|                                    |
  |                         |-- finish --------------------------|
  |                         |-- msg success + finalize --------->|
  |                         |-- run_terminal + done + [DONE] --->|
  |<----- close ------------|                                    |
```

### 9.2 阶段 A：断线

```
Client                API(request_bound)              Upstream
  |-- SSE ... -------->|-- streaming ---------------->|
  X disconnect         |-- abort -------------------->|
                       |-- persist partial assistant  |
                       |-- finalize interrupted       |
                       |-- events: run_terminal+done  |
  |-- GET events?after=N ---------------------------->|
  |<-- missed envelopes + terminal -------------------|
  UI: 显示部分内容 + interrupted（可 continue）
```

### 9.3 阶段 B：断线仍生成

```
Client          API                 Queue/Worker           Upstream
  |-- POST ---->|-- run queued ---->|                      |
  |<- runId/SSE |                   |-- claim + stream --->|
  X leave       |                   |-- events ------------>|
  |-- later GET stream?after=N ---->|-- read events -------|
  |<---- catch-up + live -----------|                      |
  |                   stop?         |-- abort if stop -----|
```

---

## 10. 失败矩阵

| 场景 | 用户可见 | run.status | message.status | events | 重试建议 |
|------|----------|------------|----------------|--------|----------|
| 上游 5xx 耗尽 | error 帧 | failed | interrupted 或无正文 | error+terminal | 新 idem key 重试 |
| 用户 Stop | 停止标记 | interrupted | interrupted | terminal | continue API |
| A 网络断开 | 重连后部分内容 | interrupted | interrupted | 重放至 terminal | continue |
| B 网络断开 | 重连后继续/完成 | 保持/终态 | 随终态 | 追上 | attach |
| 幂等同 key 同 body | 附着同一 run | 不变 | 不变 | 重放 | — |
| 幂等同 key 异 body | 409 | 不变 | 不变 | — | 新 key |
| event 写失败 | error/恢复失败提示 | failed (`terminal_reason=event_persistence_failed`) | interrupted/部分正文 | terminal 尽力写，允许有缺口 | 停止按 seq 拼接，以 messages/status 为准刷新 |
| DB 在 finally 失败 | 今日：尽量清 generating；不发 DONE | 今日 finalize 仍尝试 | 可能缺行 | 不完整 | 刷新页 |
| lease 丢失 (B) | 生成中断 | interrupted | interrupted | terminal 补写 | 新 run/continue |
| 超大 payload | 截断事件 | 正常 | 正常 | truncated | — |

---

## 11. 迁移与回滚策略

### 11.1 迁移顺序

1. **Expand**：加表/加列，全可空或有 default；应用仍按旧逻辑写 `running`。
2. **Dual-write**：新代码写 `streaming`+events；读兼容 `running|streaming`。
3. **Switch**：前端启用 resumable；灰度 B。
4. **Contract**（可选）：停写旧扁平字段；bootstrap 僵尸收敛增强。

### 11.2 回滚

| 层级 | 回滚方式 |
|------|----------|
| 前端 | 关 flag；旧 `consumeChatSSE` 忽略 id |
| API 写 events | 关 `chat.resumable_sse`；不再 append（表可留） |
| 幂等 | 客户端停发 key 即退回 |
| B worker | 停注册 handler + `chat.detached_run=false`；POST 回 request_bound |
| Schema | **不删列**回滚代码；表留存无害。危险删除迁移仅在确认无读后另做 |

### 11.3 与未提交 P0/P1/P2-A 的关系

- 实现 issue **基于** P1-A `run-lifecycle` 合并后的主干。
- 本设计任务 **零业务 diff**；落地时避免与 P1-A 未提交文件无序互踩：实现前先合并/提交 P1-A。
- `route.ts` 为热点文件：I2/I3/I5 **串行**，禁止并行改。

---

## 12. 模块落点（实现期）

| 模块 | 路径建议 | 职责 |
|------|----------|------|
| 事件存储 | `src/lib/chat/run-events.ts` | append/list/cleanup |
| 幂等 | `src/lib/chat/idempotency.ts` | fingerprint + lookup |
| 发射器 | `src/lib/chat/run-event-emitter.ts` | 合并 delta + SSE 编码 |
| 状态机 | 扩展 `run-lifecycle.ts` | 转换 + finalize + lease |
| 执行器 B | `src/lib/chat/run-executor.ts` + worker | detach 生成 |
| API | `src/app/api/chat/runs/[runId]/...` | status/events/stream/stop |
| 前端 SSE | `src/features/chat/model/sse.ts` | 解析 id/信封 |
| 前端 store | `chatStreamStore.ts` | seq reducer + 重连 |

复用：`toSafeJsonb`、`createRunId`、`getQueue`、`getSession`、属主校验模式。

---

## 13. 关键决策摘要

1. **先 A 后 B**；A 明确 abort 上游，只保证事件/消息可恢复。
2. **events 是 run 时序日志，messages 是对话真相**。
3. **幂等键客户端生成**，范围 user+conversation+key，冲突 409。
4. **delta 合并落库**，控制事件同步落库；payload 16KiB + 脱敏。
5. **SSE `id=eventId=runId:seq`**；`run_terminal`+`done` 对齐终态；保留 `[DONE]` 兼容。
6. **B 用 pg-boss + 租约**，不引入 AgentHarness；上游不可断点续传。
7. **5 个串行可发布 issue**（见 `implement.md`），`route.ts` 不并行。
