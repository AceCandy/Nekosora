# Implement — 用量日志副任务区分与统计页打磨

## 执行顺序（低风险前置）

### Step 1 — Schema 加列（Q2 数据层）
- `src/db/schema/pg.ts`：usage_logs + ops_error_logs 加 `taskKind: text("task_kind")`。
- `src/db/schema/sqlite.ts`：同名字段同步。
- `pnpm db:generate:pg` 生成迁移。
- verify：迁移文件生成、列 nullable。

### Step 2 — logUsage 透传 taskKind（Q2）
- `src/lib/usage.ts`：`LogUsageParams` 加 `taskKind?`；两表 insert 写 `taskKind: params.taskKind ?? null`。
- verify：typecheck。

### Step 3 — stream.ts 透传 + httpStatus（Q2 + Q6）
- `StreamChatOptions` / `GenerateChatOptions` 加 `taskKind?`。
- 4 处 `logUsage` 调用透传 `taskKind: opts.taskKind`。
- 加 `SHORT_HTTP_STATUS` 常量；4 处失败分支补 `httpStatus`。
- verify：typecheck。

### Step 4 — 副任务调用点传 taskKind（Q2）
- `memory/extract.ts` streamChat → `taskKind: "memory"`。
- `conversation-title/service.ts` generateChat → `taskKind: "title"`。
- `compact/service.ts` streamChat → `taskKind: "compact"`。
- verify：typecheck。

### Step 5 — Repository DTO 加 taskKind（Q2）
- `usage-aggregate.ts` UsageLogRow + toUsageRow。
- `error-log-repository.ts` ErrorLogRow + toRow。
- verify：typecheck。

### Step 6 — 前端展示 + 类型 + i18n（Q2）
- `UsageLogsTable` / `ErrorLogsTable` ClientRow 类型 + 来源列副任务徽标。
- `page.tsx`（admin + panel）序列化透传 taskKind。
- i18n zh + en 加 `taskKinds.*`。
- verify：typecheck + lint。

### Step 7 — 刷新按钮（Q3）
- `UsageFilterBar` / `ErrorFilterBar` 第一排右侧加 RefreshButton（router.refresh）。
- verify：typecheck + lint。

### Step 8 — 时间秒级（Q4）
- `format.ts` 加 `second: "2-digit"`。
- verify：typecheck。

### Step 9 — 错误表去详情列（Q5）
- `ErrorLogsTable` 删表头列 + 行按钮 cell；colSpan -1。
- verify：typecheck + lint。

### Step 10 — 全量校验
- `pnpm check`（lint + typecheck）。
- `pnpm test`（若有相关单测）。
- verify：全部通过。

## 回滚点
- 每步独立可回滚；Step 1 的加列迁移可用对应删列迁移撤销（数据无损，列本身 nullable）。
