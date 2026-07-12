# 用量查询合一：一套页面 + 权限数据隔离

## Goal

将 `/panel/usage`（全员查自己）与 `/admin/usage`（admin 跨用户）合并为单一页面 `/panel/usage`，按 role 做数据隔离：admin 默认查自己、可切换查全部用户；普通用户隐藏用户筛选、服务端强制仅查自己。

## Background

- 现状两套页面代码高度重复，仅 variant 与 userId 逻辑不同。
- `/admin/usage` 无侧栏入口，admin 丢失跨用户查询能力。
- `listUsageLogs` 语义：传 userId 隔离、不传看全部；admin 需要"默认查自己"，故需新增默认逻辑。

## Requirements

### R1 单一入口与路由
- 唯一入口 `/panel/usage`；侧栏"用量查询"指向它（admin / user 共用）。
- `/admin/usage` 改为重定向到 `/panel/usage`（保留 query string），删除其 page 实现。

### R2 权限数据隔离（服务端强制）
- 普通用户：`effectiveUserId` 恒为 `session.user.id`，忽略 URL `user` 参数（防越权）；隐藏用户筛选、用户列、上游 key 列脱敏（沿用现 panel 行为）。
- admin：
  - 无 `user` 参数 → 默认查自己（`session.user.id`）
  - `user=__all__` → 查全部用户（不传 userId）
  - `user=<id>` → 查指定用户
  - 显示用户筛选（含「全部用户」选项）、用户列、上游 key 列

### R3 统计区联动
- 用量总览、时间序列、模型分布、来源分布均按 R2 解析出的 `effectiveUserId` 查询。

### R4 标题统一
- 用量页标题改用 PageHeader（icon=`BarChart3`，title=`tn("myUsage")`=用量查询，desc 新增 i18n）。

## Acceptance Criteria

- [ ] /panel/usage 单页同时服务 admin 与普通用户。
- [ ] admin 默认看到自己的用量；用户筛选含「全部用户」，切换后数据正确。
- [ ] 普通用户看不到用户筛选与用户列；构造 `?user=<他人id>` 仍只返回自己的数据。
- [ ] 统计区随用户范围切换正确变化。
- [ ] /admin/usage 重定向到 /panel/usage（保留 query）。
- [ ] 标题为 PageHeader（图标 + 标题 + 描述）。
- [ ] `pnpm check` + `pnpm test` 通过；effectiveUserId 解析有单测覆盖（含普通用户越权场景）。

## Out of Scope

- 其他配置页标题与布局 → `07-12-shell-layout-page-header`。
