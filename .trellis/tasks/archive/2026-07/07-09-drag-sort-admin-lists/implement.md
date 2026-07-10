# Implement — 后台列表拖动排序

> 有序执行清单。每阶段末附验证。Review gate 在阶段 2/4 后(先跑通一处再复制模式)。
> Rollback 点:每阶段独立,revert 即回;DB 无迁移。

## 阶段 0 — 引入依赖
- [ ] `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- 验证:`package.json` dependencies 出现三者;`pnpm install` 无错。

## 阶段 1 — 后端:reorder action + 新建末尾 + 模型兜底 + bootstrap

> 模式三处同构。落点:
> - 输出方式 service `src/lib/output-modes/service.ts`、actions 在 `src/app/(dash)/admin/output-modes/page.tsx`
> - 输出样式 service `src/lib/render-styles/service.ts`、actions 在 `src/app/(dash)/admin/render-styles/page.tsx`
> - 模型全在 `src/app/(dash)/admin/actions.ts`(无独立 service)

- [ ] **1.1** output-modes service:
  - 新增 `reorderOutputModes(orderedIds: string[])`——`db.transaction` 内按 index 逐条 `update().set({sortOrder: index})`,id 不存在跳过。
  - `createOutputMode` 默认 `sortOrder = max(existing)+1`(查 max)。
- [ ] **1.2** output-modes page:
  - 新增 server action `reorderOutputModes`(“use server” + `requireAdmin` + 调 service + `revalidatePath("/admin/output-modes","page")`)。
  - create/update action 不再读 `formData.get("sort_order")`(service 自算默认)。
- [ ] **1.3** render-styles service:同 1.1(`reorderRenderStyles` + `createRenderStyle` 默认末尾)。
- [ ] **1.4** render-styles page:同 1.2。
- [ ] **1.5** models(`admin/actions.ts`):
  - 新增 `reorderModels(orderedIds)`(同模式 + revalidate)。
  - `createModel` 写 `sortOrder = max+1`(查 `globalModels` max)。
  - `listModels` 的 `orderBy` 改为 `asc(sortOrder), asc(createdAt)`(兜底)。
- [ ] **1.6** bootstrap(`src/lib/infra/db/bootstrap.ts:ensureBuiltinRenderStyles`):update 分支 `.set({...})` 去掉 `sortOrder: p.sortOrder`,保留 name/description/icon/css/renderer。create 分支不动。
- 验证:`pnpm typecheck` 通过。

## 阶段 2 — 前端:输出方式(首个样板,review gate)

> `src/features/output-modes/OutputModesManager.tsx` + `OutputModeFormDialog.tsx` + page。

- [ ] **2.1** `OutputModesManager.tsx`:
  - props 增 `reorderAction: (orderedIds: string[]) => void | Promise<void>`。
  - `useOptimistic(modes, (s, ids) => ids.map(id => s.find!).filter)` 维护乐观顺序;或 `arrayMove`。
  - 顶层包 `<DndContext sensors collisionDetection={closestCenter} onDragEnd>` + `<SortableContext items={modes.map(m=>m.id)} strategy={verticalListSortingStrategy}>`。
  - 每行 `<tr>` 套 `useSortable({id:m.id})`,最前新增 `<td>` 放 `GripVertical`(`listeners`+`attributes`+`setNodeRef`+`transform/style`)。
  - 删排序列(`<th colSortOrder>` + 对应 `<td>{m.sortOrder}`);空态 `colSpan` 保持 6。
  - `onDragEnd`:arrayMove → setOptimistic → `startTransition(() => reorderAction(orderedIds))`。
- [ ] **2.2** `OutputModeFormDialog.tsx`:删 `sort_order` 输入及相关 state/props。
- [ ] **2.3** page.tsx:把 `reorderOutputModes` action 作为 `reorderAction` 传入组件。
- **Review gate**:手测——拖动重排、松手落库、刷新顺序保持、新建在末尾。模式跑通再进阶段 3。
- 验证:`pnpm typecheck` + 手测。

## 阶段 3 — 前端:输出样式(复制样板 + builtin)

- [ ] **3.1** `RenderStylesManager.tsx`:同 2.1。`paper`(builtin)同样作为 sortable item 参与拖动(只锁 cssClass/不可删,不锁顺序)。
- [ ] **3.2** `RenderStyleFormDialog.tsx`:删 `sort_order` 输入。
- [ ] **3.3** page.tsx:传 `reorderAction = reorderRenderStyles`。
- 验证:paper 可拖动;**重启服务后顺序不回弹**(验证 1.6 生效)。

## 阶段 4 — 前端:模型(补链路 + 双 `<tr>`,review gate)

> `src/features/models/ModelsManager.tsx` + `models/page.tsx`。最大风险:双 `<tr>` Fragment。

- [ ] **4.1** `ModelItem` 接口(`ModelsManager.tsx:23-34`)补 `sortOrder: number`。
- [ ] **4.2** `models/page.tsx` 映射时带 `sortOrder`。
- [ ] **4.3** `ModelsManager.tsx`:
  - DndContext/SortableContext 同前,`items = models.map(m=>m.id)`。
  - `useSortable` 的 ref/listeners/transform 只绑**主 `<tr>`;展开路由 `<tr>` 不注册为 sortable item。
  - 拖拽中若主行展开,收起展开行(避免视觉错位)——实现时验证,必要时加 `isDragging` 判定隐藏展开行。
  - 加手柄列;空态/展开行 `colSpan` +1(注意 `hasAccessScope` 的 7/8 列)。
- **Review gate**:手测——模型拖动落库、刷新保持、新建末尾、展开/收起不破坏拖动。
- 验证:`pnpm typecheck` + 手测。

## 阶段 5 — i18n

- [ ] `messages/zh-CN.json` / `en.json`:删 `colSortOrder`(outputModes / renderStyles 两处);按 UI 调整增删 key(如手柄 aria-label)。
- 验证:无缺失 key 报错;`pnpm typecheck`。

## 阶段 6 — 测试与验收

- [ ] 单测:service `reorderOutputModes`/`reorderRenderStyles` + `reorderModels`(乱序 id → 0..n、跳过不存在 id);`create*` 默认 max+1;bootstrap 若有单测则更新断言。
- [ ] `pnpm check`(lint + typecheck)全绿。
- [ ] `pnpm test`(vitest)全绿。
- [ ] 手测验收(对照 prd Acceptance Criteria 全勾):
  - 三处拖动落库、刷新保持
  - 输出方式/样式无排序输入与列、DB 列仍在
  - 模型可拖动、新建末尾
  - paper 重启不回弹
  - 用户端下拉顺序一致

## Rollback

- 各阶段独立,revert 对应 commit 即回。
- DB 无 schema 变更,存量 `sort_order` 保留,不影响功能。
- `@dnd-kit/*` 回滚时可保留(无害)或卸载。

## 备注

- 三处 DnD 接入若高度重复,可在阶段 4 后评估是否抽一个 `SortableRow`/hook;但 prd Out of Scope 默认不重构,重复可接受。
- reorder 多行 update 务必包 `db.transaction`,避免半成品状态。
