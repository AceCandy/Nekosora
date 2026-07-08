# 网关日志UI打磨与布局统一 — 技术设计

> 配套 `prd.md`。本文讲技术方案：时间时区、key 双字段、路由列收敛、耗时/token 格式、admin 布局。

## 1. 时间时区（R1）

**现状**：`page.tsx` 用 `r.createdAt.toISOString()` 输出 UTC ISO（带 `Z`）；`UsageLogsTable.formatDateTime` 用 `new Date(iso).getHours()`（浏览器时区）。理论上应自动 +8，但用户反馈晚 8 小时。

**可能根因**（按概率）：
1. **`createdAt` 存储时区偏移**：PG `timestamp`（without time zone）+ 服务器时区若非 UTC，`defaultNow()` 存本地时间，drizzle 按 UTC 解释 → Date 偏移。或 SQLite epoch mode 配置问题。
2. **SSR 渲染时区**：Next.js 对 `"use client"` 组件仍 SSR，服务端 `getHours()` 用服务器时区（UTC），hydrate 前显示 UTC。

**方案**（分两步）：
- **Step A（前端，必做）**：`formatDateTime` 改用 `toLocaleString` 明确走浏览器时区：
  ```ts
  new Date(iso).toLocaleString(undefined, { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false })
  ```
  只要 `iso` 是真 UTC instant，浏览器即显示本地时间。
- **Step B（数据层，按需）**：实现时先打印 `createdAt` 原始值 vs `toISOString()` 对照 DB，确认 instant 是否正确。若存储层偏移（PG 服务器时区问题），考虑 schema 列改 `timestamp with time zone` 或在序列化修正。**先做 Step A，若仍偏移再查 Step B**。

抽到 `src/shared/format.ts`（或现有 utils），UsageLogsTable / ErrorLogsTable / ErrorDetailDrawer 共用。

## 2. 路由列收敛（R2）

**现状**（UsageLogsTable 9 列）：createdAt / source / model / provider / route / upstreamModel / totalTokens / latency / ttft。

**收敛后**：createdAt / source / model（对外名）/ **路由（= routeName，已是 `服务商·上游模型`）** / key（R3）/ token（R5 三列）/ latency / ttft。

- 删 `provider`、`upstreamModel` 单独列（信息已在 routeName）。
- `routeName` 列改名展示为「路由」。
- model 列保持 `r.model`（对外名）。

## 3. key 命中双字段（R3）

### 上游 provider key（前3后3 `*`，写入快照）
- **schema**：`usage_logs` + `ops_error_logs` 各加 `upstreamKeyMasked text null`（pg + sqlite 双 dialect）。
- **写入**：`logUsage` 接收上游 key 明文（stream.ts 已持有 `usedRoute.provider.apiKey`），算脱敏快照写入：
  ```ts
  function maskKey(k?: string): string | null {
    if (!k) return null;
    return k.length <= 6 ? `${k.slice(0,2)}***` : `${k.slice(0,3)}***${k.slice(-3)}`;
  }
  ```
- **透传**：stream.ts 三处 `logUsage` 调用补传 `upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey)`；多模态 adapter 同理（从 result 取）；route.ts 层错误（无 usedRoute）留 null。

### 对外网关 key（用 name，JOIN 取）
- **查询 JOIN**：`listUsageLogs` / `listErrorLogs` 加 `LEFT JOIN apiKeys ON apiKeyId = apiKeys.id`，select `apiKeys.name as apiKeyName`。
- **DTO** 加 `apiKeyName: string | null`。不改写入链路（避免改 CallContext / 鉴权）。

### 前端展示
- 用量明细表新增「Key」列：上行 `apiKeyName`（用户 key 名），下行 `upstreamKeyMasked`（上游 key，灰字 mono）。或两列，按空间定。
- **panel 错误视图脱敏**：key 两字段都在 panel 白名单外（不下发），延续数据层脱敏。

## 4. 耗时自适应格式（R4）

抽 `formatDuration(ms)` 到 `src/shared/format.ts`：
```ts
ms < 1000    → `${ms}ms`
ms < 60_000  → `${(ms/1000).toFixed(1)}s`
ms < 3_600_000 → `${(ms/60000).toFixed(1)}m`
else         → `${(ms/3600000).toFixed(1)}h`
```
用在 latency + TTFT 列（UsageLogsTable / ErrorLogsTable / ErrorDetailDrawer）。

## 5. token 三列（R5）

- `listUsageLogs` select 加 `cacheReadTokens`（usage_logs 已有列）；DTO `UsageLogRow` + `UsageLogClientRow` 加 `cacheReadTokens`。
- 前端用量明细表 token 区：输入(prompt) / 输出(completion) / 缓存读取(cacheRead) 三列（或一个单元格内三行）。参照 sub2api 风格。
- 错误表 token 暂不强调（失败请求 token 多为 0），保持现状或轻量。

## 6. admin 全部页铺满（R6）

- `src/app/(dash)/layout.tsx` 用 `AppShell` 包 children，**内容区宽度由 AppShell 控制**；各 admin 页自己套 `max-w-5xl`。
- **改动**：admin 各页去掉外层 `max-w-5xl`（改 `w-full` 或直接去掉），内容填满 AppShell 内容区。
- 影响页（`rg max-w-5xl` in admin）：`admin/page`、`usage/page`、`settings/page`、`templates/page`、`users/page`、`operations/page`、`render-styles/page`、`output-modes/page`、`providers`、`models` 等。
- **表单类页**（settings）：去外层 max-w，但表单卡片内部保留合理宽度约束（如 `max-w-2xl` 卡片），避免表单过宽难看。
- panel 页本期不动。

## 7. 风险

- **时间根因**需实现时确认（Step A 先行，必要时 Step B 查存储）。
- admin 全宽后表格行变长，注意列宽 / truncate（已有 `max-w-[Npx] truncate`）。
- 历史数据无 `upstreamKeyMasked`（null），展示降级「-」。
- JOIN apiKeys：apiKeyId 为 null（chat）时 LEFT JOIN 得 null，正常。

## 8. 不在本设计内

apiKeys 加 keySuffix、panel 页铺满、统一 chat 的 messages 时间显示（仅日志页）。
