# List Drag-Sort(列表拖动排序)

> 后台/个人配置的列表(输出模式 / 输出样式 / 全局模型 / 个人模型)用「拖动手柄 + 松手即落库」排序的可复用模式。基于 `@dnd-kit` + React 19 `useOptimistic` + server action。

---

## 何时套用

- 管理端/用户端某张表需要用户自定义行顺序,且顺序要持久化、影响下游(如 chat 工具栏下拉顺序)。
- 数据层有 `sortOrder`(integer notNull default 0)列;查询 `orderBy(asc(sortOrder), asc(createdAt))`(createdAt 兜底,消除「全 0」时的无序)。

## 端到端数据流

```
onDragEnd(arrayMove)
  → useOptimistic reducer 按新 id 顺序重排(立即渲染)
  → startTransition(async () => { setOptimistic(newIds); await reorderAction(newIds); })
        → service:按 dialect 的 transaction 内按 index 重写 sortOrder=0,1,2…
        → revalidatePath
  → server 重渲染 → useOptimistic 自动对齐真实数据(顺序一致)
```

## 前端模式(@dnd-kit)

- **`useSortable` 必须在独立行组件内调用**,不能在 `.map` 回调里(违反 hooks 规则)。抽 `SortableXxxRow` 同文件内子组件。
- 顶层:`<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd>` 包住 `<SortableContext items={rows.map(r=>r.id)} strategy={verticalListSortingStrategy}>`,`sensors = useSensors(useSensor(KeyboardSensor), useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))`(两个都要,见下节)。
- 行:`useSortable({id})` 的 `setNodeRef`/`transform`/`style`/`listeners`/`attributes` 绑到 `<tr>`;最前列放 `GripVertical` 手柄(`<button {...attributes} {...listeners}>`,`cursor-grab`)。`transform` 用 `CSS.Transform.toString(transform)`(@dnd-kit/utilities)套到 `style`。
- `useOptimistic(rows, (state, orderedIds) => orderedIds.map(id => map.get(id)).filter(Boolean))`。

## 键盘可达性:同时注册 KeyboardSensor

仅注册 `PointerSensor` 时,键盘用户无法重排(违反 WCAG 2.1.1 键盘可达)。dnd-kit 必须同时注册 `KeyboardSensor`:聚焦拖动手柄后 Space 拾起、方向键移动、再次 Space 落下。手柄 `<button>` 已有 `aria-label` 并展开 `{...listeners}`,无需额外接线。

```tsx
const sensors = useSensors(
  useSensor(KeyboardSensor),
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
);
```

垂直列表用 dnd-kit 默认 keyboard coordinate getter 即可(↑/↓ 上下)。验证:Tab 到手柄 → Space 拾起 → ↑/↓ 移动 → Space 落下,顺序正确落库。

## SSR hydration: DndContext 必须传稳定 id

`@dnd-kit` 未传 `id` 时会以模块级计数生成 `DndDescribedBy-<n>`。Node SSR 进程已处理过的请求会推进计数，而浏览器首次 hydration 从不同计数开始，导致拖拽手柄的 `aria-describedby` 不一致。

服务端渲染的每个 `<DndContext>` 必须传入**页面内唯一且确定**的 `id`；同页存在多个排序域时，id 要反映域名：

```tsx
// 错误: SSR 与客户端会依赖不同的模块级计数
<DndContext sensors={sensors} onDragEnd={onDragEnd} />

// 正确: dnd-kit 直接使用该固定值作为 aria-describedby
<DndContext id={`models-${visibility}-sortable`} sensors={sensors} onDragEnd={onDragEnd} />
```

模型的私有和公开分组分别使用 `models-private-sortable`、`models-public-sortable`；单一排序表也要使用类似 `models-sortable` 的固定 id。验证时以实际 Next 页面加载检查浏览器控制台无 hydration warning，并确认每个手柄的 `aria-describedby` 是预期固定值。

## ⚠️ 关键契约:落库必须 `await`(最常见的坑)

`useOptimistic` 的乐观态生命周期**绑在 transition 上**。落库 server action **必须**在 `startTransition` 的 **async 回调里 `await`**:

```tsx
// ✅ Correct:await 期间 transition 保持 pending,乐观态持续到 revalidate 对齐
startTransition(async () => {
  setOptimisticRows(newIds);
  await reorderAction(newIds);
});
```

```tsx
// ❌ Wrong:fire-and-forget,transition 回调同步返回即结束
startTransition(() => {
  setOptimisticRows(newIds);
  void reorderAction(newIds); // 不 await
});
```

**症状**:乐观态在 server action 完成 + `revalidatePath` 送回真实数据**之前**就回退到旧顺序,造成**「新序 → 旧序 → 新序」的可见闪动**;`isPending` 也会过早翻 false。

**约束**:本仓所有 `startTransition` 统一 `async () => await ...Action()`(见 KeysManager/CardsManager 等)。新增拖动/乐观落库不得例外。

## reorder server action 契约

```ts
async function reorderXxx(orderedIds: string[]): Promise<void> {
  await requireAdmin(); // 或 requireSession(个人模型)
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(t).set({ sortOrder: i }).where(eq(t.id, orderedIds[i]));
    }
  });
  revalidatePath("/...");
}
```

- **全表重写连续整数**(0,1,2…)——简单、幂等、无空洞。表数据量小(几十),逐条 update 可接受。
- **单事务**包裹,中途失败整体回滚(避免半成品状态)。
- **事务 callback 可 async**:PostgreSQL drizzle transaction 接受 `async` callback,内部用 `await tx.update(...)`。
- **id 不存在自然跳过**:`update ... where id=?` 影响 0 行,不抛错(拖动时客户端传的 id 可能过期)。
- **per-user / per-scope 隔离**:个人模型 reorder 每条 update 必须带 `and(eq(id, orderedIds[i]), eq(userId, user.id))`,防止越权改他人顺序。
- **不新增 REST `/api`**:沿用 server action + `revalidatePath` 模式。

## create 默认放末尾

新建项 `sortOrder = coalesce(max(sortOrder), -1) + 1`(空表从 0 起);per-user 表的 max 查询要带 `where(userId)`。

```ts
const [maxRow] = await db
  .select({ maxSort: sql<number>`coalesce(max(${t.sortOrder}), -1)` })
  .from(t);
const nextSort = (maxRow?.maxSort ?? -1) + 1;
```

## 双 `<tr>` 行(主行 + 可展开子面板)的拖动

模型列表行是 `<Fragment>` 包「主 `<tr>` + 可展开路由 `<tr>`」两条平级 tr:

- `SortableContext.items` 只含主行 id;`useSortable` 的 ref/transform/listeners **只绑主 `<tr>`**。
- 展开行**不注册为 sortable item**,作为兄弟 `<tr>` 跟随。
- **拖拽中收起展开行**:展开行渲染条件 `expanded && !isDragging`——主行正被拖时隐藏其下方面板,松手 `isDragging` 复位、面板恢复。无需在 DndContext 层维护 draggingId(`useSortable` 对每个 item 单独测距,非 sortable 的兄弟 tr 不影响)。
- 加手柄列后,空态与展开行的 `colSpan` 用单一 `colCount` 变量驱动(动态列如 `accessScope` 也要计入)。

## 一处组件两种变体的隔离(全局 vs 个人)

`ModelsManager` 被 `/admin/models`(global)与 `/panel/models`(byo)共用。拖动只在「有 reorderAction + 有 sortOrder 链路」时启用:

```ts
const reorderable = Boolean(reorderAction); // 不再硬绑 isAdmin
```

- 启用:DndContext + 手柄列 + SortableXxxRow;`colCount` +1。
- 未启用(byo 未传 reorderAction,或其他无排序场景):纯 `<table>`,无手柄列,`colCount` 不变。

## 内置(builtin)项的排序持久化

bootstrap ensure 的内置项(如输出样式 `paper`)若 update 分支每次启动覆盖 `sortOrder`,用户拖动后的顺序会被重置。**update 分支不得覆盖 sortOrder**(只刷新 name/description/icon/css/renderer);create 分支(首次插入)仍写默认值。`builtin` 的「不可删 / cssClass 不可改」约束与排序无关,不锁顺序。

## UI 原语 additive 扩展(以 OptionPicker badgeVariant 为例)

给共享原语加可选展示字段时,务必 **additive**:新字段缺省时走原渲染路径,不破坏既有调用方。

```tsx
// OptionItem 新增可选 badgeVariant;有则用有色 Badge,无则沿用原灰色文字 span
{opt.badge && opt.badgeVariant ? (
  <Badge variant={opt.badgeVariant} ...>{opt.badge}</Badge>
) : (
  <span className="text-[10px] text-neutral-400 font-mono">{opt.badge}</span>
)}
```

指令卡(`/${trigger}`)、知识库(`${fileCount} 文件`)不传 `badgeVariant`,视觉不变。

## 参考

- 全局模型:`src/features/models/ModelsManager.tsx`(`SortableModelRow` + 双 tr)、`src/app/(dash)/admin/actions.ts:reorderModels`。
- 输出模式:`src/features/output-modes/OutputModesManager.tsx`(`SortableOutputModeRow`)、`src/lib/output-modes/service.ts:reorderOutputModes`。
- 个人模型(per-user 隔离):`src/app/(dash)/panel/actions.ts:reorderMyModels`。
