# Design — 用量查询合一

## 合并策略
- 保留 `/panel/usage/page.tsx` 作为唯一实现；删除 `/admin/usage/page.tsx`，原路径用 `redirect()` 跳转 `/panel/usage`（保留 query string），兜底书签 / 外链。
- 页面内按 `session.user.role` 分支，复用现 `variant: "admin" | "panel"`（UsageFilterBar / UsageLogsTable / ErrorLogsTable / ErrorFilterBar 已支持）。

## effectiveUserId 解析（核心，安全收敛点）
```
role === "admin":
  sp.user === "__all__" ? undefined        // 显式查全部
  : sp.user ? sp.user                      // 查指定用户
  : session.user.id                        // 默认查自己

role === "user":
  session.user.id                          // 强制自己，忽略 sp.user（防越权）
```
- 统一传入：`listUsageLogs({ userId: effectiveUserId, … })`、`getTimeSeries(range, effectiveUserId)`、`getModelBreakdown(range, effectiveUserId)`、`getSourceBreakdown(range, effectiveUserId)`、totals 聚合。
- 普通用户即使 URL 带 `?user=<他人id>`，服务端 `effectiveUserId` 仍为自己 → 越权不可达。

## 「全部用户」选项
- admin 的用户 Combobox 顶部加固定选项 `__all__`（label = i18n「全部用户」）；普通用户不渲染用户筛选（沿用 variant=panel）。
- 默认（无 `user`）= 查自己，Combobox 回显当前 admin。

## 组件复用
- variant 机制不变：admin 显示用户列 / 上游 key 列 / 用户筛选；panel 隐藏用户列、上游 key 脱敏。
- 共用 UsageDashboard / CollapsibleStats / UsageTabs / UsageLogsTable / ErrorLogsTable，原样复用。
- 候选搜索：`searchUsageCandidatesAction`（admin 跨用户）/ `searchPanelUsageCandidatesAction`（强制自己）不变。

## 安全审查
- 数据隔离点收敛在 page server component 的 `effectiveUserId` + 聚合函数 userId 入参，**不依赖前端隐藏**。
- `/admin/usage` 重定向后无 requireAdmin 闭环风险（/panel/usage 对所有登录用户可达，但普通用户被 effectiveUserId 隔离）。

## 兼容性 / 回滚
- 删除 `/admin/usage` 前确认无侧栏入口（已无）、无文档硬链。
- 回滚：恢复两个 page.tsx；移除重定向。
