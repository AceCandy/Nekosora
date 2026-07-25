# Implement: P2-B 可恢复 SSE 与请求幂等

> 本文件是**实现路线图**。当前 Trellis 任务 `07-25-resumable-chat-stream` 仅交付文档；下列 Issue 落地时再各自 `task.py create` 或开 PR。
> **前置**：合并/提交 P0/P1/P2-A（尤其 P1-A run-lifecycle）后再动 `route.ts`。
> **原则**：issue 串行依赖；写集隔离；每期可回滚；禁止把 A 伪装成 B。

---

## 总览

```
I1 schema + run_events 存储
  └─► I2 请求幂等（POST 入口）
        └─► I3 阶段 A：事件发射 + 重放/状态/stop API + 终态收敛
              └─► I4 前端 seq 去重 + 重连
                    └─► I5 阶段 B：解耦执行器 + 租约（可选独立发布）
```

| Issue | 名称 | 阶段 | 可独立发布 | 依赖 |
|-------|------|------|------------|------|
| I1 | Event store 与 runs 扩展 | 基建 | 是（无行为变化） | P1-A |
| I2 | POST 幂等 | A | 是 | I1 |
| I3 | 可重放 SSE（request_bound） | A | 是 | I1, I2 |
| I4 | 前端恢复消费 | A | 是 | I3 契约 |
| I5 | Detached producer | B | 是（flag 默认关） | I1–I4 |

---

## Issue 写集隔离（禁止并行踩踏）

| 文件/区域 | I1 | I2 | I3 | I4 | I5 |
|-----------|----|----|----|----|-----|
| `src/db/schema/pg.ts` | **W** | — | — | — | 只读/极少 |
| `drizzle/pg/*` | **W** | — | — | — | — |
| `src/lib/chat/run-events.ts` | **W** | r | r/扩展 | — | r |
| `src/lib/chat/run-lifecycle.ts` | 状态枚举扩展可在此 | r | **W** 转换 | — | lease **W** |
| `src/lib/chat/idempotency.ts` | — | **W** | r | — | r |
| `src/app/api/chat/route.ts` | — | **W 入口块** | **W 流式块** | — | **W 创建/enqueue** |
| `src/app/api/chat/runs/**` | — | — | **W** | — | 附着增强 |
| `src/lib/chat/run-event-emitter.ts` | — | — | **W** | — | r |
| `src/lib/chat/run-executor.ts` | — | — | — | — | **W** |
| `src/worker.ts` | — | — | — | — | **W** |
| `src/features/chat/model/sse.ts` | — | — | — | **W** | — |
| `src/features/chat/store/chatStreamStore.ts` | — | — | — | **W** | 小改 mode |
| `src/lib/infra/metrics.ts` | — | — | 指标 | 指标 | 队列指标 |
| `src/lib/infra/db/bootstrap.ts` | 僵尸 run 清理可 I1 或 I3 | — | 推荐 **W** | — | lease 清理 |

**约定**：

- I2 与 I3 都碰 `route.ts` → **必须串行**（先合 I2 再开 I3）。
- I5 再改 `route.ts` 时只动「创建后是否 enqueue」分支，不重写 I3 发射器。
- 测试文件跟随各 issue 写集，不跨 issue 抢同一 test 大改。

---

## I1 — Event store 与 runs 扩展

### 目标

落地 `run_events` 表与 `runs` 扩展列；提供纯存储 API + 单测；**不改变** `/api/chat` 运行时行为。

### 写集

- `src/db/schema/pg.ts`
- `drizzle/pg/00xx_run_events.sql` + `meta/_journal.json` + snapshot
- `src/lib/chat/run-events.ts`（新建）
- `src/lib/chat/run-events.test.ts`（新建）
- 可选：`bootstrap` 批清理钩子骨架（noop flag）

### 不做

- 不改 route/前端
- 不改 `model_catalog`
- 不启用 event 双写

### 实现要点

1. 按 `design.md` §4 SQL 草案加列/表/索引。
2. `appendRunEvent` / `listRunEventsAfter` / `getRunById`；seq 分配与 `runs.last_seq` 同事务。
3. payload：`toSafeJsonb` + 16KiB 截断。
4. 状态字面量类型导出；读路径兼容旧 `running`。

### 验收命令

```bash
pnpm exec vitest run src/lib/chat/run-events.test.ts
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | head -50  # 若项目惯用 pnpm typecheck 则用之
git diff --check
# 迁移：在有 DATABASE_URL 的环境
# pnpm db:generate:pg  # 若手写 SQL 则跳过 generate，确保 journal 一致
```

### 回滚

- 代码回退；DB 列/表保留（expand-only）。
- 禁止在回滚 PR 中 `DROP TABLE run_events`（除非确认无生产数据且单独审批）。

### 完成定义

- [ ] 迁移可在干净库 apply
- [ ] append 唯一约束冲突可测
- [ ] 无 route 行为 diff

---

## I2 — 请求幂等

### 目标

`POST /api/chat` 支持 `idempotencyKey`：同 user+conv+key 同指纹附着，异指纹 409；防重复 user/run。

### 写集

- `src/lib/chat/idempotency.ts` + `.test.ts`（新建）
- `src/app/api/chat/route.ts`（**仅** JSON 解析后、流创建前的幂等分支；最小化 diff）
- 可选：`runs` 写入 `idempotency_key` / `request_fingerprint` / `intent`（经 run-lifecycle 小函数）

### 不做

- 不写 run_events
- 不改 SSE 帧
- 不改前端（前端发 key 放到 I4；I2 可用单测/curl 验收）

### 实现要点

1. `buildChatRequestFingerprint(body)` 稳定序列化。
2. 事务/唯一索引冲突处理。
3. 命中同指纹：无论 run 是否终态，绝不重新执行或第二次 insert user。I2 固定返回 `200 JSON { resumed:true, runId, status, mode }`；I3 起固定返回 `200 JSON { resumed:true, runId, status, mode, streamUrl }`。终态客户端刷新 messages，非终态客户端 attach。
4. 无 key：旧路径。

### 验收命令

```bash
pnpm exec vitest run src/lib/chat/idempotency.test.ts
# 含 route 级 mock 测若存在：
pnpm exec vitest run src/app/api/chat/ 2>/dev/null || true
git diff --check
```

### 回滚

- 客户端停发 key / 服务端忽略 key 字段。
- 回退 route 入口块与 idempotency 模块。

### 完成定义

- [ ] 双 POST 同 key 同 body 不产生两条 user
- [ ] 同 key 异 body → 409
- [ ] 无 key 行为与今日一致

---

## I3 — 阶段 A：事件发射 + 重放 API + interrupted 收敛

### 目标

request_bound 模式下：生成过程 append events、SSE 带 `id:`、提供 events/status/stop；断线仍 abort 上游并正确 `interrupted`；**不**后台继续生成。

### 写集

- `src/lib/chat/run-event-emitter.ts` + test（新建）
- `src/lib/chat/run-lifecycle.ts`（状态扩展：preparing/streaming/waiting_tool；finalize 兼容）
- `src/lib/chat/run-lifecycle.test.ts`
- `src/app/api/chat/route.ts`（**流式循环与 finally**；调用 emitter；响应头 `X-Run-Id`）
- `src/app/api/chat/runs/[runId]/route.ts`（status）
- `src/app/api/chat/runs/[runId]/events/route.ts`
- `src/app/api/chat/runs/[runId]/stream/route.ts`（A：重放+若已终态即关）
- `src/app/api/chat/runs/[runId]/stop/route.ts`
- `src/lib/infra/db/bootstrap.ts`（僵尸非终态 run → interrupted）
- metrics 计数器

### 不做

- 不引入 worker 生成
- 不改 model_catalog
- 不要求前端必发 key（兼容旧客户端只收 id 忽略）

### 实现要点

1. 控制事件同步 append→enqueue；delta 50ms/256B 合并。任一事件持久化失败即停止上游并把 run 收敛为 `failed`（`terminal_reason=event_persistence_failed`）；客户端遇到 seq 缺口停止拼接并刷新 messages/status。
2. 双写扁平字段 + 信封（design §6.4）。
3. finally：`run_terminal` + `done` + `[DONE]`；terminal 与 messages 顺序不变式。
4. stop：对 request_bound 等价 abort 当前执行（需 runId→AbortController 进程内表；多实例 A 仅本机有效——文档写明）。
5. Feature flag `chat.resumable_sse`。

### 验收命令

```bash
pnpm exec vitest run \
  src/lib/chat/run-events.test.ts \
  src/lib/chat/run-event-emitter.test.ts \
  src/lib/chat/run-lifecycle.test.ts \
  src/lib/stream-agent-loop.test.ts
git diff --check
```

手工/集成（有环境时）：

1. 正常对话：DB `run_events` 有序，`last_seq` 匹配。
2. 中途断 fetch：run=`interrupted`，messages 部分内容，events 含 terminal。
3. `GET events?after=0` 可重建 UI 前缀。
4. 确认 **无** worker 继续计费/上游请求（日志/usage）。

### 回滚

- `chat.resumable_sse=false` 立即停写停发 id。
- 回退 route 流式块与 runs API 路由；保留表。

### 完成定义

- [ ] A 语义测试与文档一致（断线不继续生成）
- [ ] 旧客户端仍可完成对话
- [ ] 僵尸 run 启动可收敛

---

## I4 — 前端 seq 去重与重连

### 目标

客户端生成幂等键；解析 SSE id/信封；按 seq 应用；网络错误退避重连重放；保留 version/feedback/toolCalls；无重复 delta。

### 写集

- `src/features/chat/model/sse.ts` + 测试（若有/新建 `sse.test.ts`）
- `src/features/chat/store/chatStreamStore.ts` + `chatStreamStore.test.ts`
- `src/features/chat/hooks/useChatRuntime.ts`（仅接线需要时）
- 可选：`src/features/chat/model/types.ts` 扩展 runtime 相关类型
- i18n：仅错误/中断文案若需（`messages/en.json` / `zh-CN.json`）— **勿**写「后台生成」

### 不做

- 不改 DB
- 不实现 B 的无限重连产品文案
- 不重做虚拟滚动/markdown

### 实现要点

1. send/regenerate/edit/continue 创建并附带 `idempotencyKey`；网络自动重试复用。
2. `lastSeq` / `activeRunId` 进 runtime。
3. 重连：`GET /api/chat/runs/:id/stream?after=` 或 events+短轮询；`request_bound` 限制 maxAttempts。
4. 终态后优先信任 messages 刷新，避免 delta 与 SSR 全文双加。
5. `stopGeneration`：abort + 调 stop API（若有 runId）。

### 验收命令

```bash
pnpm exec vitest run \
  src/features/chat/store/chatStreamStore.test.ts \
  src/features/chat/model/sse.test.ts
git diff --check
```

### 回滚

- 停发 `idempotencyKey` / 忽略信封走旧扁平解析分支（feature detect）。

### 完成定义

- [ ] 单测覆盖重复 seq 丢弃、乱序填洞策略
- [ ] 重连不重复追加正文
- [ ] toolCalls/feedback/versionInfo 不被事件应用清空

---

## I5 — 阶段 B：解耦执行器（独立发布，默认关）

### 目标

`mode=detached`：POST 创建 run 后由 worker/executor 拉上游；浏览器断开不 abort 生产者；客户端 attach 追上；租约防多实例双跑。

### 写集

- `src/lib/chat/run-executor.ts` + test（新建；从 route 抽生成核心）
- `src/worker.ts`（注册 `chat-run` 队列）
- `src/lib/infra/queue.ts` 若需 createQueue 名文档化
- `src/app/api/chat/route.ts`（仅把 I3 的 request-bound 执行入口替换为 enqueue，并返回固定 `202 JSON + streamUrl`；不改 I3 事件发射块）
- `src/app/api/chat/runs/[runId]/stream/route.ts`（直播订阅）
- `run-lifecycle` lease/heartbeat
- metrics：queue delay

### 不做

- 不上游 half-output 续传
- 不跨区 exactly-once
- 不引入 AgentHarness
- flag 默认 **off**

### 实现要点

1. 将「prepare 之后的生成+落库+事件」抽到 executor，route 的 I3 request-bound 路径与 worker 共用；I5 在 flag 开启时只替换创建后的调度适配层。
2. claim 租约；heartbeat；terminal 释放。
3. 客户端断开 **不** 调 abort；仅 stop API / 超时 / 失败 中止。
4. `generating` 与活跃 detached run 对齐；bootstrap 不可再无脑清所有 generating 而不收敛 run（与 I3 僵尸逻辑统一）。
5. 产品/API：`run.mode=detached` 才允许「后台生成」文案。

### 验收命令

```bash
pnpm exec vitest run \
  src/lib/chat/run-executor.test.ts \
  src/lib/chat/run-lifecycle.test.ts \
  src/lib/chat/run-events.test.ts
git diff --check
# 有 worker 环境时：启 worker，POST 后 kill 客户端，确认 usage 仍完整、attach 可收齐
```

### 回滚

- `chat.detached_run=false` + 停 worker handler；POST 回 request_bound。
- 进行中 detached run：stop 或等 lease 过期 → interrupted。

### 完成定义

- [ ] flag off 时与 I3 行为一致
- [ ] flag on：断客户端后上游仍完成且 events 完整
- [ ] 双 worker 不双跑同一 run
- [ ] 文档与 UI 不将 A 描述为 B

---

## 本设计任务（文档）检查清单

1. [x] 创建 `.trellis/tasks/07-25-resumable-chat-stream/`
2. [x] `task.json` / `prd.md` / `design.md` / `implement.md`
3. [x] JSON 可解析 + markdown 存在性
4. [x] `git diff --check` 无空白错误
5. [x] 确认无业务源码被本任务修改

### 文档任务验收命令

```bash
python3 -c "import json; json.load(open('.trellis/tasks/07-25-resumable-chat-stream/task.json'))"
test -f .trellis/tasks/07-25-resumable-chat-stream/prd.md
test -f .trellis/tasks/07-25-resumable-chat-stream/design.md
test -f .trellis/tasks/07-25-resumable-chat-stream/implement.md
git diff --check
git status --short -- .trellis/tasks/07-25-resumable-chat-stream
```

---

## 风险与开放问题

| 风险 | 缓解 |
|------|------|
| `route.ts` 持续与其他 chat 任务冲突 | 先合 P1-A；I2→I3→I5 串行 |
| event 写放大拖 TTFT | delta 合并；控制事件同步、delta 异步可选但 A 重放会弱化 |
| 多实例 A 的 stop 无效 | 文档限制；B 用 DB 停标 |
| bootstrap 清 generating 与 B 后台冲突 | I5 重写清理：只清无活跃 run 的会话 |
| 前端 delta 与 SSR 全文双加 | I4 终态刷新策略 |

开放问题（实现 I3/I4 前可再钉）：

1. stream 附着用 DB 轮询还是 `LISTEN/NOTIFY`？（首发轮询 200–500ms 更简单）
2. `title_updated` 是否进入 run_events？（可保持今日侧栏独立路径）

---

## 明确不做（全 issue 共通）

- Pi AgentHarness
- 改变 `model_catalog` 单一事实源
- 跨区域 exactly-once
- 网关 `/v1` 可恢复协议
- 本设计任务内任何 schema/业务代码修改
