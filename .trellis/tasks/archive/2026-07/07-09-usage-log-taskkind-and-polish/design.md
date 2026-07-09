# Design — 用量日志副任务区分与统计页打磨

## R1. task_kind 字段（Q2）

### Schema（双表 + 双 dialect）
- `src/db/schema/pg.ts`：`usageLogs` 与 `opsErrorLogs` 各加 `taskKind: text("task_kind")`（nullable，无 default）。
- `src/db/schema/sqlite.ts`：同名字段同步。
- pg migration：`pnpm db:generate:pg`（生成加列迁移；nullable 列安全）。

### 数据流
```
副任务调用点(taskKind)
  → streamChat/generateChat(taskKind 透传)
  → logUsage(taskKind) → schema.task_kind
```
- `LogUsageParams` 加 `taskKind?: string`；`logUsage` 两表 insert 均 `taskKind: params.taskKind ?? null`。
- `StreamChatOptions` / `GenerateChatOptions` 加 `taskKind?: string`；stream.ts 内 4 处 `logUsage` 调用透传 `taskKind: opts.taskKind`。

### 副任务落点
| 副任务 | 文件 | 入口 | taskKind |
|---|---|---|---|
| 记忆抽取 | `src/lib/memory/extract.ts:60` | `streamChat` | `memory` |
| 标题生成 | `src/lib/conversation-title/service.ts:85` | `generateChat` | `title` |
| 摘要压缩 | `src/lib/compact/service.ts:237` | `streamChat` | `compact` |

主回复（`/api/chat`）与网关（`/v1/chat/completions`）不传 → `null`。

### DTO + 前端
- `usage-aggregate.ts`：`UsageLogRow` + `toUsageRow` 加 `taskKind`。
- `error-log-repository.ts`：`ErrorLogRow` + `toRow` 加 `taskKind`。
- 前端 `UsageLogClientRow` / `ErrorLogClientRow` 加 `taskKind`；`page.tsx`（admin + panel）序列化透传。
- 展示：用量明细「来源」列在副任务行追加低饱和徽标（`title`/`memory`/`compact`）；错误表「来源」列同理。
- i18n：`admin.usage.taskKinds.{title,memory,compact}`（zh + en）。

## R2. 刷新按钮（Q3）
- `UsageFilterBar` / `ErrorFilterBar` 第一排右侧加 RefreshButton：`"use client"`，`const router = useRouter(); onClick={() => router.refresh()}`。
- `router.refresh()` 重跑 Server Components（不改 URL，保留当前筛选）。

## R3. 时间秒级（Q4）
- `src/shared/lib/format.ts` `formatDateTimeLocal` options 加 `second: "2-digit"`。一处生效，明细/错误/详情抽屉全用此函数。

## R4. 错误表去「详情」列（Q5）
- `ErrorLogsTable.tsx`：删表头 `errors.viewDetail` 列（`:130`）+ 行内按钮 cell（`:204-215`）。
- 空表 colSpan：admin `10 → 9`、非 admin `9 → 8`。

## R5. 错误日志补 httpStatus（Q6）
- `stream.ts` 新增短码→HTTP 映射（不动 errorCode 字面值，保护 error-classify 与历史数据）：
```ts
const SHORT_HTTP_STATUS: Record<string, number> = {
  generation_failed: 502, routing_error: 503,
  model_not_found: 404, model_not_available: 404, model_not_bound: 403,
  no_route: 503, capability_not_supported: 400,
};
```
- 4 处 `logUsage` 失败分支补 `httpStatus: SHORT_HTTP_STATUS[errCode] ?? 500`（成功分支不传）。
  - streamChat routing-fail（`errCode`）、streamChat finally（`failedErrorCode`）、generateChat routing-fail、generateChat finally。

## 兼容性 / 回滚
- `task_kind` nullable 新列，历史行自动 null；删列迁移可回滚。
- httpStatus 仅填充新错误行，历史 null 行不受影响、前端已有 `-` 兜底。
- errorCode 字面值零改动。

## 风险
- 副任务 DTO 链路长（schema→logUsage→stream→副任务→repository→page→table），任一环漏传导致 null；用 typecheck + 实际发一条带标题的消息验证。
- pg migration 需在部署前 `db:migrate:pg`。
