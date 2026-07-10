# 后台列表拖动排序(输出方式 / 输出样式 / 模型设置)

## Goal

把后台三处列表(输出方式 `/admin/output-modes`、输出样式 `/admin/render-styles`、模型设置 `/admin/models`)的排序方式,从「手填数字 sortOrder」改成「拖动手柄 + 松手即落库」。同时移除输出方式 / 输出样式里用户可见的排序输入框与排序列(数据库 `sort_order` 列保留,作为拖动的落点)。

## Background

现状(已调研确认):
- 三处表都有 `sort_order` 列(integer notNull default 0),查询大多按 `asc(sortOrder)` 排。
- **输出方式 / 输出样式**:sortOrder 全链路贯通——表单可手填、列表有展示列、用户端 chat 工具栏下拉也按它排。
- **模型设置**:sortOrder 在 schema/查询里有,但 UI 层完全断裂——`createModel`/`updateModel` 从不写入(恒为 0)、不显示、不可编辑,实际无序。
- **内置样式**:输出样式的 `paper`(纸面杂志)由 `bootstrap.ts:ensureBuiltinRenderStyles` 启动时 ensure 进库,`builtin=true`,不可删、cssClass 不可改;其 update 分支每次启动会覆盖 sortOrder 为硬编码 0。
- 三处前端用同一套 `<table>` 布局;模型行是 `<Fragment>` 包裹「主行 + 可展开路由行」两条 `<tr>`,比另两处复杂。
- 项目当前未引入任何 DnD 库。

## Requirements

1. **三处统一拖动**:每行最前新增一列拖动手柄(lucide `GripVertical`,`cursor-grab`),拖动重排,松手即落库。
2. **松手即落库**:拖动结束 → 乐观更新本地顺序 → 调 `reorder` server action(按传入 id 顺序重写连续整数 0,1,2…) → `revalidatePath`。不做「前端实时排 + 手动点保存」。
3. **输出方式 / 输出样式:移除用户可见排序字段**——删表单「排序」输入框、删列表「排序」展示列。**DB `sort_order` 列保留**,查询 `orderBy` 保留。
4. **模型设置:补齐链路再上拖动**——`createModel` 写入 sortOrder(新增项 = 当前 max+1)、`updateModel` 不改它、`ModelItem` 带字段、查询 `orderBy` 加 `createdAt` 兜底。
5. **内置样式 `paper` 允许拖动**:改 `bootstrap.ts` update 分支不再覆盖 sortOrder(只刷新 name/description/icon/css/renderer),保证拖动后顺序重启不回弹。`builtin` 的「不可删 / cssClass 不可改」约束不变。
6. **新增项排序**:三处新建一律默认放末尾(sortOrder = max(existing)+1)。
7. **用户端一致**:用户侧 chat 工具栏选「输出方式 / 输出样式」的下拉顺序随后端 sortOrder 自然变化(无需额外接口)。
8. **i18n 同步**:zh-CN / en 文案随结构调整增删。
9. **个人模型(`/panel/models`)拖动**:`user_models` 加 `sort_order` 列(双 dialect 迁移,additive default 0),`reorderMyModels` action(userId 隔离),`ModelsManager` 放宽 `reorderable = Boolean(reorderAction)` 使 byo 也可拖;`getMyModels` 排序、`createMyModel` max+1(per-user)。
10. **chat 模型顺序与标识**:用户侧模型列表改为「个人模型(按其顺序)在前 → 全局模型(按全局顺序)在后」;全局模型项文字后加小标签标识,个人模型不加(原生 select option 用文字后缀;`ChatMessageItem` 重生成列表同步)。

## Constraints

- 复用现有 **server action + `revalidatePath`** 模式,不新增 REST `/api` 路由。
- DnD 库统一用 `@dnd-kit/core` + `@dnd-kit/sortable`(React 19 友好,维护活跃);不引入已废弃的 react-beautiful-dnd。
- 所有 server action 入口经 `requireAdmin()`。
- 设计 token / 现有 UI 原语(`Button`、`StatusDot`、`Badge`),无裸 hex,无投影静止态(遵守 DESIGN)。
- 不破坏:builtin 不可删、cssClass 不可改、路由级联删除、`accessScope` 动态列。

## Acceptance Criteria

- [ ] 三处列表可拖动重排;松手后**刷新页面顺序不变**(确认落库)。
- [ ] 输出方式 / 输出样式:表单无「排序」输入、列表无「排序」列;DB `sort_order` 列仍在、查询仍按它排。
- [ ] 模型设置可拖动且持久;新建模型默认在末尾。
- [ ] 内置样式 `paper` 可拖动;拖动后**重启服务顺序不回弹**。
- [ ] 三处新建项默认排序在末尾。
- [ ] 用户端 chat 工具栏「输出方式 / 输出样式」下拉顺序与后台一致。
- [ ] `pnpm check`(lint + typecheck)通过;`pnpm test`(vitest)通过;若改动触及 service/bootstrap 则补/更对应单测。
- [ ] zh-CN / en 文案同步,无遗漏 key。
- [ ] `/panel/models` 个人模型可拖动重排、松手落库、刷新保持、新建末尾;`/admin/models` 全局模型仍正常。
- [ ] `user_models` 加列迁移已生成(pg+sqlite),bootstrap 启动 migrate 无报错。
- [ ] chat 模型选择器:个人模型在前、全局在后;全局模型项带小标签,个人无;`ChatMessageItem` 重生成列表同步。

## Out of Scope

- 不动「路由(route)」层的 priority / weight(那是路由决策,与列表展示排序不同概念)。
- 不改 providers 列表排序。
- 不做跨列表 / 跨页拖动。
- 不重构这三处表格为统一通用组件(仅在各自组件内加 DnD,除非实现中发现三处高度重复再评估)。
- (原 Out of Scope 的「不动 BYO/chat」已按用户新需求 9/10 纳入;路由层 priority/weight 仍不动。)
