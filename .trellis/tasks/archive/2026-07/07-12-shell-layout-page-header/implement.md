# Implement — 配置页布局与标题对齐

## 步骤

1. 新建 `src/shared/components/PageHeader.tsx` → verify: import 无报错，props 类型正确。
2. 改 `src/shared/components/AppShell.tsx` 外层 `min-h-screen` → `h-screen` → verify: 本地起服务，长内容页（如用量页）右侧在框内滚动、侧栏与品牌区固定。
3. 替换以下页面标题为 PageHeader（用量页留给 usage-page-unify，不动）：
   - panel: keys、models、providers、templates、memory、knowledge（标杆，改复用组件后视觉不变）
   - admin: models、providers、templates、users、operations、settings、output-modes、render-styles
   - → verify: 每页标题为「图标 + 标题 + 描述」，知识库视觉与改前一致。
4. 为缺描述的页面补 i18n key（`messages/zh-CN.json` + `messages/en.json`）→ verify: 无 i18n missing。
5. 改 nav 文案（zh-CN + en 的 `nav` 命名空间，见 PRD 表）→ verify: 侧栏显示新名称。
6. `pnpm check` + `pnpm test` → verify: 全绿。

## Validation
- `pnpm check`（lint + typecheck）
- `pnpm test`
- 人工：普通屏下长内容页框内滚动；矮屏（≈600px 高）侧栏底部不被挤爆。

## Review Gates
- 步骤 2 后人工确认布局（限高是外层行为改动，影响所有 (dash) 页）。
- 步骤 3 后确认知识库页视觉零回归。

## Rollback
- 还原 `AppShell.tsx` 一行；删除 PageHeader；各页标题还原。
