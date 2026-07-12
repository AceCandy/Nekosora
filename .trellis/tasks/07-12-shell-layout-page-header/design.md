# Design — 配置页布局与标题对齐

## 关键决策

### D1 限高：min-h-screen → h-screen
- 现状 `AppShell` 外层 `flex min-h-screen`：`min-h-screen` 允许内容撑高超出视口，整页（含侧栏）跟随滚动，这是"页面过高"根因。
- 改为 `h-screen`：固定视口高度；`<aside>` 与 `<main>` 为 flex 兄弟，`<main>` 已有 `overflow-auto`，自然形成「侧栏固定 + 主区框内滚动」。
- 影响面：仅 `(dash)/layout.tsx` 一处使用 AppShell → panel + admin 全部配置页。
- 边界风险：极矮视口下侧栏底部（语言切换 / 登出）可能被挤压。aside 已 `justify-between`；若验收发现溢出，给 aside 内导航区加 `overflow-y-auto`、底部区 `shrink-0`。不预先加（YAGNI）。

### D2 PageHeader 组件
- 位置：`src/shared/components/PageHeader.tsx`（布局壳，与 AppShell/SidebarNav 同级；不放 `shared/ui` 原语层）。
- Server Component（无 `"use client"`）。
- props：`icon: LucideIcon`、`title: string`、`desc?: string`。
- 样式锚定知识库标杆：
  - `<h1 className="text-xl font-bold flex items-center gap-2"><Icon className="w-5 h-5 text-sora-blue" /><span>{title}</span></h1>`
  - `<p className="text-sm text-neutral-500 dark:text-neutral-400">{desc}</p>`
- 不内置 max-width（保持各页外层容器现状，最小化差异）。

### D3 标题替换策略
- 逐页把 `<h1>…</h1>[+<p>…]` 替换为 `<PageHeader icon={…} title={tn(…)} desc={t("desc")} />`。
- 描述文案优先复用各页现有 `panel.*.desc` / `admin.*.desc`；缺失项新增 i18n key（zh + en）。
- 图标映射（lucide）：keys→Key、providers→Server、models→Boxes、templates→FileText、memory→Brain、knowledge→Library、users→Users、operations→Activity、settings→Settings、outputModes→SlidersHorizontal、renderStyles→Palette。
- `admin/page.tsx`（主页，`text-2xl`）属仪表盘性质，**不纳入**本次统一，保持现状。

## 兼容性 / 回滚
- 纯展示层改动，无数据 / 接口变更。
- 回滚：还原 `AppShell.tsx` 一行 + 删除 PageHeader + 各页标题 JSX 还原（git revert 单子任务即可）。
