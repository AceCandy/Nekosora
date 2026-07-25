# Logging Guidelines

> Nekusora 网关调用日志架构契约。权威实现：`src/lib/usage.ts`、`src/lib/stream.ts`、`src/lib/error-classify.ts`、`src/db/schema/pg.ts`。

---

## Overview

两类日志：

1. **运行时日志**：`console.*`（开发）+ prom-client `/metrics`（运维）。轻量、不持久化业务上下文。
2. **网关调用日志**：落库持久化，供 admin/panel 用量与错误分析。**本文聚焦此类。**

网关调用日志采用**物理双表**，参考 sub2api 的分离思路：

| 表 | 存什么 | 写入条件 |
|----|--------|----------|
| `usage_logs` | 成功且计费的调用（chat + gateway） | `status === "success"` |
| `ops_error_logs` | 失败 / 中断的调用（high-write） | `status === "failed" \| "interrupted"` |

---

## 分流契约（logUsage）

`logUsage(params)`（`src/lib/usage.ts`）是唯一写入入口，**按 `status` 自动路由到两表**，调用方不感知表结构：

```
success            → insert usage_logs   (含 TTFT/providerName/routeId/routeName/upstreamModel)
failed/interrupted → insert ops_error_logs
```

**硬规则**：

- 写入**永不阻断主流程**：整段 `try/catch`，失败只 `console.error`。
- `errorCode` 列 NOT NULL，写入时 `?? "unknown"` 兜底；`userId` 空串收敛 `null`（FK 安全）。
- Prometheus `observeRequest` 埋点不变（source/model/status/latency/tokens）。

---

## 必填 / 关键字段

**`usage_logs`**（成功用量，新增列均 nullable 兼容历史）：

- `firstTokenLatencyMs` — TTFT
- `providerName` — 可读服务商名快照（替代裸 `providerRef` 展示）
- `routeId` / `routeName` — 命中路由溯源
- `upstreamModel` — 真实上游模型名（区别于对外 `model`）

**`ops_error_logs`**（错误请求）：`requestId`(runId) / source / 身份(user/key) / model / 路由信息 / `requestPath` / `stream` / `httpStatus` / `errorCode` / `errorMessage` / `errorPhase` / `errorType` / token / `latencyMs` / `firstTokenLatencyMs`。索引：userId / createdAt / errorCode / httpStatus / providerRef / source。

---

## TTFT 采样（first token latency）

- **流式 `streamChat`**：`streamWithRoute` 在首个 `text-delta` / `reasoning-delta` 时回写共享 `timing.firstTokenAt`（`if undefined` 守卫，**first-token-wins across failover**）；`finally` 计算 `firstTokenLatencyMs = firstTokenAt - startedAt`。
- **非流式 `generateChat`**：`undefined`（一次性返回，无首 token 概念）。
- 路由解析失败 / 全路由失败：`null`。

---

## 可读 Provider / Route（写入快照）

`global_routes` / `user_routes` **无 `name` 列**，可读信息来源：

- `providerName` ← `global_providers.name` / `user_providers.name`，在 `toResolvedProvider` 注入 `ResolvedProvider.name`，logUsage 时快照。
- `routeName = ${providerName} · ${upstreamModelName}`（组合展示名）。
- `routeId` ← route 原始 id（`ResolvedRoute.routeId`）。
- `providerRef`（`<source>:<providerId>`）两表都保留，用于溯源；**前端优先展示 `providerName`，缺失降级到 `providerRef` 或 `-`**。

日志是历史记录 → 写入时**快照**，provider 改名不影响历史行。

---

## 错误分类（error-classify.ts）

`classifyError({ errorCode?, httpStatus?, errorMessage? }) → { phase, category }`，单一来源：

- **优先级**：errorCode 精确匹配 > httpStatus > errorMessage 关键字 > 兜底 `internal/other`。
- **`errorPhase`**（生命周期）：`routing` / `upstream` / `network` / `internal` / `auth` / `request`。
- **`category`**（粗分类，前端 i18n key `admin.usage.errors.categories.*`）：`auth` / `service_unavailable` / `upstream` / `internal` / `rate_limit` / `quota` / `invalid_request` / `other`。

**硬规则**：新增 `ErrorCode`（`src/lib/errors.ts`）或 RoutingError 短码时，**必须同步补 `classifyError` 映射 + 单测**，否则落到兜底分类。

---

## 错误落库边界（避免双写）

| 错误发生点 | 谁写 ops_error_logs |
|------------|---------------------|
| `streamChat`/`generateChat` **内部**（路由解析失败、生成失败） | `stream.ts` 的 `finally` |
| `route.ts` **层**（调 streamChat/adapter **之前**：auth / json / missing-field / RoutingError） | `route.ts` 自己（`logRouteError`） |

**边界**：`route.ts` 只写 pre-streamChat 错误，**不重复写** stream 内部错误（stream.ts 独占 chat 写入；多模态 adapter 自身不写日志）。

stream 层 failed 行 `httpStatus` 由 `SHORT_HTTP_STATUS`（stream 内部短码→HTTP 映射，**不动 errorCode 字面值**）补全；`requestPath` 留 null。route 层错误补全两字段。

---

## 副任务区分（task_kind）

`usage_logs` / `ops_error_logs` 均有 `task_kind`（nullable text）。**主回复 / 网关请求 = `null`；后台副任务传值**：

| 副任务 | 入口 | task_kind |
|---|---|---|
| 会话标题生成 | `conversation-title` → `generateChat` | `title` |
| 记忆抽取 | `memory/extract` → `streamChat` | `memory` |
| 摘要压缩 | `compact` → `streamChat` | `compact` |

**硬规则**：副任务复用 `streamChat`/`generateChat`（其 `finally` 各写一条日志），**必须在调用时透传 `taskKind`**，否则与主回复混在 `source=chat`，造成「一请求多日志」。主回复（`/api/chat`）、网关（`/v1/chat/completions`）、多模态 adapter 不传 → `null`。

> 聚合统计（`getTimeSeries` 等）目前**不按 task_kind 过滤**，副任务 token 仍计入总量；如需排除，聚合 SQL 加 `where task_kind is null`。

---

## What NOT to Log

- ❌ 完整 request body / response body（错误表只存脱敏摘要 / requestPath）。
- ❌ 凭证、Authorization header、api key 明文（上游 key 只存脱敏快照 `upstreamKeyMasked`）。

---

## 用户端隔离（panel）

panel **不做字段级脱敏**——错误日志均为用户自己调用产生，全字段可见（含 errorMessage/provider/上游 key 快照），便于用户定位自己的错误。防越权靠查询层强制 userId 隔离：

- `listErrorLogs({ userId })` / `getErrorLog(id, userId)`：userId 传入即强制 `where user_id = ?`，panel 只能查到自己的行。
- panel `page.tsx` 调用时必传 `userId = session.id`；admin 不传看全部。
- panel 与 admin 共用 `ErrorLogsTable` / `ErrorDetailDrawer`，仅 panel 不渲染用户列/用户筛选（variant=panel）。

> 历史：曾对 panel 做字段级脱敏（服务端置空 errorMessage/provider 等白名单外字段），后发现用户看自己的错误需要全字段，改为 userId 隔离 + 全字段下发。

---

## 查询层

- `src/lib/repositories/error-log-repository.ts`：`listErrorLogs({ page, pageSize, userId?, filters? })` / `getErrorLog(id, userId?)`。**userId 传入即强制 `where`**（panel 防越权），admin 不传看全部。
- `src/lib/usage-aggregate.ts` `listUsageLogs`：用量明细分页 + 筛选。
- 聚合（`getTimeSeries` / `getModelBreakdown` / `getSourceBreakdown`）只查 `usage_logs` → 失败不进 → **自然只统计成功**，无需改。
- AUTH 噪声：`ops_error_logs` 默认 `excludeErrorPhase: "auth"`（扫描流量放大），用户可显式显示。

---

## Common Mistakes

- **在调用点手写 insert usage_logs/ops_error_logs** → 必须走 `logUsage`，由它按 status 分流。
- **route.ts 重复写 stream 内部错误** → 只写 pre-streamChat 错误，避免双写。
- **新增 ErrorCode 没补 `classifyError` 映射** → 错误落到兜底 `internal/other`，分类失真。
- **panel 防越权靠字段置空** → 靠查询层 `userId` 强制 where（`listErrorLogs` / `getErrorLog`）；字段级脱敏会让用户无法定位自己的错误。
- **`logUsage` 抛错阻断主流程** → 永不抛错，失败只 `console.error`。
- **副任务调 streamChat/generateChat 不传 `taskKind`** → 与主回复混在 source=chat，用量明细出现「一请求多日志」；标题/记忆/压缩必须透传。

## Scenario: WebChat Run 审计生命周期

### 1. Scope / Trigger

- `/api/chat` 创建一次用户可见生成时，将现有 `runs`、`tool_calls` 与 `messages.runId` 接入审计链路。
- 不在该场景新增 schema；请求幂等与事件重放另行设计。

### 2. Signatures

- `startRun({ runId, conversationId, userId, platformModelName })`
- `recordToolCallStart({ runId, toolCallId, toolName, args })`
- `recordToolCallResult({ runId, toolCallId, result, isError })`
- `finalizeRun({ runId, status, tokenUsage })`
- `resolveRunTerminalStatus({ finished, aborted, sawError, persistenceFailed })`

### 3. Contracts

- 普通发送、重试、编辑重发与续写每轮生成唯一 `runId`；同一 Agent 多轮必须共享该值。
- 新建 user 与本轮新建/续写 assistant 写入 `runId`；复用历史 user 时不得改写其归属。
- run/tool DB 写入均为 best-effort，失败只记录短错误，不阻断模型流或记录工具敏感参数。
- 所有 SSE 帧必须经取消安全的 `safeEnqueue` 写入；run 必须在最内层 `finally` 从 `running` 收敛。
- `finish` 是权威完成信号；完成后的客户端 abort 不得把成功 run 降级，收尾持久化失败除外。

### 4. Validation & Error Matrix

| 条件 | `runs.status` | assistant 状态 |
|---|---|---|
| 收到 `finish` 且收尾持久化成功 | `success` | `success` |
| 未收到 `finish` 的显式流错误 / 抛出异常 | `failed` | `interrupted` |
| abort 或 maxSteps 未收到 finish | `interrupted` | `interrupted` |
| assistant / 会话收尾持久化失败 | `failed` | 未可靠持久化 |

### 5. Good / Base / Bad Cases

- Good：Agent 两轮的 tool-call/tool-result 与最终 assistant 都关联同一 run。
- Base：无工具的普通生成仍创建并收敛一条 run，SSE 载荷不变。
- Bad：直接 `controller.enqueue` 在客户端取消后抛错，使收尾 `finally` 未执行并留下 `running` run。

### 6. Tests Required

- `run-lifecycle.test.ts` 覆盖终态优先级、usage 映射、敏感 JSONB 规范化与 DB 失败隔离。
- Agent loop 测试断言每轮 `streamChat` 接收同一 `runId`。
- route 接线复核须覆盖 send/retry/edit/continue 的消息 `runId` 规则与 abort/error/finalize 边界。

### 7. Wrong vs Correct

```typescript
// Wrong:取消竞态可抛出并跳过 run 收尾。
controller.enqueue(frame);

// Correct:丢弃已关闭流的帧,终态仍由 finally 收敛。
safeEnqueue(frame);
await finalizeRun({ runId, status, tokenUsage });
```
