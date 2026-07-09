# 执行计划 — 网关日志页：统计上移折叠 + 筛选下拉 + 列重构

> 配套 prd.md + design.md。按 Phase 执行，每 Phase 独立 commit，最后统一验证。

## Phase 1 — 后端：distinct 候选 + userId 筛选

1. `usage-aggregate.ts`：
   - 新增 `listUsageFilterOptions(userId?)` → { models, providers, routes, users }
   - `UsageLogFilters` 加 `userId?: string`；`buildUsageWhere` 加 userId 条件
   - `listUsageLogs` 再 LEFT JOIN `user` 取 name/email；`UsageLogRow` 加 userName/userEmail
2. `error-log-repository.ts`：
   - 新增 `listErrorFilterOptions(userId?)`
   - `ErrorLogFilters` 加 `userId?: string`；`buildWhere` 加 userId 条件
   - `listErrorLogs` 再 LEFT JOIN `user`；`ErrorLogRow` 加 userName/userEmail
3. 双 dialect 验证 distinct（pg / sqlite）
- **verify**：typecheck；手查候选返回正确（含/不含 userId 隔离）

## Phase 2 — page：注入候选 + 筛选参数

1. `admin/usage/page.tsx`：调 listUsageFilterOptions/listErrorFilterOptions 注入 UsageFilters options；filterValues 加 userId/range；range 同时驱动 dashboard + 列表
2. `panel/usage/page.tsx`：同（传 userId 隔离；users 候选空；不加用户筛选字段）
3. UsageLogsTable/ErrorLogsTable clientRow 透传 userName/userEmail
- **verify**：typecheck；下拉有候选；用户筛选(admin)生效

## Phase 3 — 统计上移 + 折叠

1. 新建 `CollapsibleStats.tsx`（client，折叠 + localStorage `usage-stats-collapsed`，SSR 安全初始化）
2. admin/panel page：UsageDashboard 移出 tab 内部到 UsageTabs 上方，包 CollapsibleStats
3. `UsageDashboard`：移除内部 RANGES 选择器，range 改 props 传入（筛选栏 range 驱动）
4. range 统一：筛选栏 range query → dashboard 图表 + 列表 startAt 共用
- **verify**：折叠可切换 + 持久；切 tab 统计不变；range 驱动图表正确

## Phase 4 — 用量表列重构 + token tooltip

1. `UsageLogsTable`：合并列（路由/token/耗时）+ 用户列(admin) + variant(panel 无用户列)
2. token tooltip：info 图标 + Popover(openOnHover) 四行明细
3. i18n：列头 thUser + tooltip 标签 + 折叠按钮（zh/en）
- **verify**：渲染正确；panel 无用户列/无泄露；tooltip 正常

## Phase 5 — 错误表合并列

1. `ErrorLogsTable`：服务商/路由/模型合并一列（admin）+ 用户列(admin)
2. i18n 补
- **verify**：渲染正确；ErrorDetailDrawer 不破

## Phase 6 — 验证

1. `pnpm check`（lint + typecheck）
2. `pnpm test`
3. 手动：折叠持久、下拉候选正确、用户筛选(admin)、时间范围、列合并、token tooltip、panel 脱敏、东八区时间无 hydration 报错
- **verify**：全绿

## 回滚点

- 每 Phase 独立 commit
- 后端 distinct/userId 为新增查询 + 可选筛选，不破坏旧路径
- 前端列重构为纯展示，可回退
- 统计上移 + 折叠为结构变更，单 commit 可回退
