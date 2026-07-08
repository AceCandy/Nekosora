# 执行计划 — 网关日志UI打磨与布局统一

> 配套 `prd.md` + `design.md`。按 Phase 执行，最后统一验证。

## Phase 1 — schema + 写入：上游 key 脱敏快照

1. `pg.ts` + `sqlite.ts`：`usageLogs` + `opsErrorLogs` 各加 `upstreamKeyMasked text null`
2. `db/types.ts`：如需导出
3. `usage.ts`：`logUsage` 加 `upstreamKeyMasked` 入参 + insert；`maskKey()` 工具
4. `stream.ts` 三处 + 多模态 adapter：补传 `upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey)`
5. 迁移：`pnpm db:generate:pg` + `pnpm db:push:sqlite`
- **verify**：typecheck + 现有 test 不破

## Phase 2 — 查询：JOIN apiKeys.name + cacheReadTokens

1. `error-log-repository.ts` `listErrorLogs` / `getErrorLog`：LEFT JOIN `apiKeys` 取 `name as apiKeyName`；DTO 加 `apiKeyName`
2. `usage-aggregate.ts` `listUsageLogs`：LEFT JOIN `apiKeys` + select `cacheReadTokens`；`UsageLogRow` 加 `apiKeyName` / `cacheReadTokens`
3. `admin/usage/page.tsx` + `panel/usage/page.tsx`：`clientRows` 透传 `apiKeyName` / `upstreamKeyMasked` / `cacheReadTokens`
- **verify**：typecheck；查询返回新字段

## Phase 3 — 前端格式化工具 + 时间修复

1. 新建 `src/shared/format.ts`：`formatDuration(ms)` + `formatDateTimeLocal(iso)`（浏览器时区）
2. 时间 R1：先用 `formatDateTimeLocal`（toLocaleString 浏览器时区）；实现时打印 createdAt 原始值 vs toISOString 对照，若仍偏移查存储层（Step B）
- **verify**：手动对照时间正确

## Phase 4 — 前端表格调整

1. `UsageLogsTable`：路由列收敛（删 provider/upstreamModel 单列，routeName 改「路由」）、加 Key 列（apiKeyName + upstreamKeyMasked）、token 三列（输入/输出/缓存读取）、耗时用 formatDuration、时间用 formatDateTimeLocal
2. `ErrorLogsTable` + `ErrorDetailDrawer`：耗时 formatDuration + 时间 formatDateTimeLocal + admin 展示 key 双字段；**panel variant 不展示 key**（脱敏）
3. i18n：新列头（路由 / Key / 输入 / 输出 / 缓存读取），zh-CN + en
- **verify**：渲染正确；panel 无 key 泄露

## Phase 5 — admin 全部页铺满

1. 各 admin 页去掉外层 `max-w-5xl`（`admin/page` `usage/page` `settings/page` `templates/page` `users/page` `operations/page` `render-styles/page` `output-modes/page` `providers/*` `models/*`）
2. settings 等表单页：去外层 max-w，表单卡片内部留合理宽度
- **verify**：大屏无右侧留白；表单不过宽

## Phase 6 — 验证

1. `pnpm check`（lint + typecheck）
2. `pnpm test`
3. 手动：时间正确（浏览器时区）、路由列收敛、key 双字段、耗时格式、token 三列、admin 铺满、panel 脱敏
- **verify**：全绿

## 回滚点

- 每 Phase 独立 commit
- schema 仅加 nullable 列，不破坏旧
- 前端格式化为纯展示，可回退
