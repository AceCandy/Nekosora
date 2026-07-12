# Implement — 用量查询合一

## 前置依赖
- `07-12-shell-layout-page-header` 已产出 PageHeader 组件 + nav.myUsage 文案。

## 步骤

1. 改 `/panel/usage/page.tsx`：引入 `role` 分支与 `effectiveUserId` 解析；统计区（getTimeSeries/getModelBreakdown/getSourceBreakdown/totals）与 listUsageLogs 改用 effectiveUserId；admin 的 UsageFilterBar 用户 Combobox 增加「全部用户」(`__all__`) 选项。→ verify: admin 默认查自己、切「全部」/指定用户数据正确；普通用户强制自己。
2. 删除 `/admin/usage/page.tsx`，原路径改为 `redirect()` → `/panel/usage`（保留 query）。→ verify: `/admin/usage?tab=errors` 跳到 `/panel/usage?tab=errors`。
3. 用量页标题换 PageHeader（icon=BarChart3，title=`tn("myUsage")`，desc 新增 i18n）。→ verify: 标题样式与其他页一致。
4. 补 i18n：「全部用户」zh + en；用量页 desc zh + en。→ verify: 无 missing。
5. 补单测：`effectiveUserId` 解析矩阵（admin 默认自己 / `__all__` / 指定 id；普通用户强制自己、带 sp.user 也忽略）。→ verify: 用例全过。
6. `pnpm check` + `pnpm test`。→ verify: 全绿。

## Validation
- `pnpm check` + `pnpm test`
- 人工：admin 账号切换「全部用户 / 指定用户 / 默认自己」三个范围，统计区与列表一致变化；普通账号构造 `?user=<他人id>` 验证只返回自己数据。

## Review Gates
- 步骤 1 后人工验证三个范围的数据正确性（数据隔离是安全边界）。
- 步骤 5 单测必须覆盖普通用户越权场景。

## Rollback
- 恢复 `/admin/usage/page.tsx`；还原 `/panel/usage/page.tsx` 的 effectiveUserId 逻辑与「全部用户」选项。
