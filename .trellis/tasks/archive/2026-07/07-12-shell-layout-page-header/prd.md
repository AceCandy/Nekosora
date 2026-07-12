# 配置页布局与标题对齐：限高一屏 / PageHeader / tab 重命名

## Goal

让 (dash) 段所有配置页固定一屏、标题样式统一（图标 + 标题 + 描述），侧栏 tab 命名规整。产出可复用的 PageHeader 组件供用量页合一子任务复用。

## Requirements

### R1 限高一屏
- `src/shared/components/AppShell.tsx` 外层 `min-h-screen` → `h-screen`，`<main>` 保持 `overflow-auto`，使左侧栏固定、右侧内容在框内滚动。

### R2 PageHeader 组件
- 新建 `src/shared/components/PageHeader.tsx`（Server Component），props：`icon: LucideIcon`、`title: string`、`desc?: string`。
- 样式锚定知识库标杆：图标 `w-5 h-5 text-sora-blue` + `text-xl font-bold` 标题 + `text-sm text-neutral-500` 描述。

### R3 标题统一（非用量页）
将以下页面标题替换为 PageHeader（用量页 `/panel/usage`、`/admin/usage` 留给 usage-page-unify）：
- panel：keys、models、providers、templates、memory、knowledge（标杆，改复用组件）
- admin：models、providers、templates、users、operations、settings、output-modes、render-styles
- `admin/page`（主页 dashboard，`text-2xl`）**不纳入**，保持现状
- 图标：keys=`Key`、models=`Boxes`、providers=`Server`、templates=`FileText`、memory=`Brain`、knowledge=`Library`、users=`Users`、operations=`Activity`、settings=`Settings`、outputModes=`SlidersHorizontal`、renderStyles=`Palette`
- 缺描述的页面补 i18n（zh + en）

### R4 侧栏 tab 重命名（nav 文案）
`messages/zh-CN.json` 与 `messages/en.json` 的 `nav` 命名空间：

| key | zh 现状 → 目标 | en 现状 → 目标 |
|---|---|---|
| keys | API 密钥管理 → 密钥管理 | API Keys（不变）|
| providers | 上游服务商 → 服务商管理 | Providers（不变）|
| models | 模型代理 → 模型管理 | Models（不变）|
| templates | Prompt 模板 → 提示词模板 | Prompt Templates（不变）|
| memory | 长期记忆归档 → 长期记忆 | Memory Archive → Memory |
| users | 用户账号管理 → 账号管理 | Users → Accounts |
| settings | 设置 → 系统设置 | Settings → System Settings |
| myUsage | 我的用量 → 用量查询 | My usage → Usage |
| cards / knowledge / operations / outputModes / renderStyles | 保留 | 保留 |

## Acceptance Criteria

- [ ] (dash) 页面固定一屏，右侧内容滚动而非整页。
- [ ] PageHeader 组件存在且被上述页面复用。
- [ ] 标题均为「图标 + 标题 + 描述」；知识库改用 PageHeader 后视觉不变。
- [ ] nav 文案按表更新，zh + en 同步。
- [ ] `pnpm check` + `pnpm test` 通过。

## Out of Scope

- 用量页（/panel/usage、/admin/usage）标题与合并逻辑 → `07-12-usage-page-unify`。
