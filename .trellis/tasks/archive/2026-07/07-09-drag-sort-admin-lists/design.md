# Design — 后台列表拖动排序

> 配套 `prd.md`。本文聚焦技术决策、契约、数据流、风险与兼容/回滚。

## 1. 边界与分层

改动落在四层,沿用项目现有分层:

| 层 | 路径 | 改动 |
|---|---|---|
| DB schema | `src/db/schema/{sqlite,pg}.ts` | **不改**(列已存在,无迁移) |
| 领域 service | `src/lib/output-modes/service.ts`、`src/lib/render-styles/service.ts`、`src/app/(dash)/admin/actions.ts`(模型无独立 service) | 新增 `reorder*`;`create*` 写 max+1;模型查询加 `createdAt` 兜底 |
| server actions | output-modes / render-styles 的 `page.tsx`;模型在 `admin/actions.ts` | 新增 `reorder*Modes/Styles/Models` action(经 `requireAdmin`) |
| 前端组件 | `src/features/{output-modes,render-styles,models}/*Manager.tsx` + 对应 `*FormDialog.tsx` | 引入 dnd-kit;加拖动列;删排序输入/列;模型补 ModelItem 字段 |
| 基建 | `src/lib/infra/db/bootstrap.ts` | `ensureBuiltinRenderStyles` update 分支不再覆盖 sortOrder |
| i18n | `messages/{zh-CN,en}.json` | 删 `colSortOrder` 等无用 key,按需新增 |

## 2. 核心契约

### 2.1 reorder server action 契约(三处同构)

```ts
"use server";
async function reorderOutputModes(orderedIds: string[]): Promise<void> {
  await requireAdmin();
  // 按 orderedIds 顺序重写 sortOrder = index(连续整数,从 0)
  // 实现:逐条 update 或事务批量;表数据量小(几十),逐条 update 可接受
  // 完成后 revalidatePath("/admin/output-modes", "page")
}
```

- 入参:`orderedIds: string[]`(客户端拖动后的完整顺序)。
- 语义:**全表重写**为 `0,1,2,…`,消除空洞。简单、幂等。
- 输出样式同理 `reorderRenderStyles`;模型 `reorderModels`(放 `admin/actions.ts`)。
- 安全:`requireAdmin()`;id 不存在/不属于本表 → 跳过(防御),不抛错以免拖动卡死。

### 2.2 前端 action 注入(沿用现有 props 模式)

现有 Manager 通过 props 接收 `createAction / updateActions[id] / toggleActions[id] / deleteActions[id]`(page 里 `.bind` 生成)。新增:

```ts
reorderAction: (orderedIds: string[]) => Promise<void> | void;
```

page.tsx 里把 server action 直接作为 prop 传入(server action 可作为普通函数引用传给 client)。

### 2.3 乐观更新数据流

```
onDragEnd(arrayMove(local))
  → useOptimistic reducer: 按新顺序重排(立即渲染)
  → startTransition(() => reorderAction(orderedIds))
        → service 重写 sortOrder → revalidatePath
  → server 重渲染 → useOptimistic 自动回退到真实数据(顺序应一致)
```

- 用 React 19 `useOptimistic(modes, reorderReducer)`,而非自管 `useState`——与 server action + revalidate 模式契合,revalidate 后自动对齐,单一数据源。
- 拖动期间 `isPending` 可给手柄一个微弱视觉态(可选,克制)。

## 3. 各处差异处理

### 3.1 输出方式 / 输出样式(简单:单 `<tr>`)
- 表头删 `colSortOrder`(`<th>`),表体删对应 `<td>`。
- 最前加 `<th>`(空,放手柄)+ 每行 `<td>` 带 `useSortable` 的 `GripVertical`(`listeners` 绑定)。
- 列数:原 6 → 删排序列 5 → 加手柄列 6。空态 `colSpan` 保持 6(巧合不变)。
- `*FormDialog.tsx`:删 `sort_order` 输入;`page.tsx` create/update 不再从 formData 读 `sort_order`。

### 3.2 模型设置(复杂:双 `<tr>` Fragment + 动态列)
这是主要实现风险点。模型行结构:`<Fragment key={m.id}>` 内含「主 `<tr>`」+「可展开路由 `<tr>`」两条平级 `<tr>`。

- dnd-kit 接入策略:`SortableContext.items` 只含 `model.id`;`useSortable({ id: m.id })` 的 `setNodeRef` + `transform/style` + `listeners` 只绑在**主 `<tr>`**;展开路由行作为兄弟 `<tr>` 跟随,不注册为 sortable item。
- 拖动时展开行处理:若主行正被拖拽,展开行建议跟随隐藏或保持(实现时验证 dnd-kit transform 是否带偏移;必要时拖拽中强制收起展开)。
- 列数:模型本无排序列,加手柄列后 6→7 / 7→8(`hasAccessScope`)。空态与展开行的 `colSpan` 同步 +1(涉及 `ModelsManager.tsx` 的 colSpan 处)。
- `ModelItem` 接口补 `sortOrder` 字段;`models/page.tsx` 映射时带上;`createModel` 写 `max(sortOrder)+1`;`updateModel` 不碰 sortOrder;`listModels` 的 `orderBy` 改为 `asc(sortOrder), asc(createdAt)` 兜底(对齐另两处)。

### 3.3 内置样式 `paper`
- `bootstrap.ts:ensureBuiltinRenderStyles` 的 **update 分支**:`.set({...})` 去掉 `sortOrder: p.sortOrder`,只保留 `name/description/icon/css/renderer`。create 分支(首次插入)仍写 `sortOrder: 0`——首次默认最前,之后由用户拖动决定,重启不再回弹。
- `builtin` 的不可删 / cssClass 不可改约束完全不动。

## 4. 关键技术选型与 tradeoff

| 决策 | 选择 | 理由 / 代价 |
|---|---|---|
| DnD 方案 | `@dnd-kit/core`+`sortable`+`utilities`,`PointerSensor` | 原生 HTML5 drag 在 `<tr>` 跨浏览器抖动;dnd-kit 可访问性好、React 19 兼容。代价:新增 3 个小依赖。 |
| 排序落库 | 全表重写连续整数 | 简单幂等、无空洞;表小,多行 update 可接受。代价:一次 N 次 update(可用事务/批量)。 |
| 前端态 | `useOptimistic` | 与 server action + revalidate 对齐,单一数据源。代价:reducer 写对即可。 |
| 删字段范围 | 只删用户可见(表单/列),DB 列保留 | 拖动落点仍是 `sort_order`;零迁移、可回滚。 |

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 模型双 `<tr>` 在 dnd-kit 下拖拽视觉错位 | 实现后优先手测;必要时拖拽中收起展开行;退路:把展开行纳入 sortable 但 items 仅主行 id |
| reorder 多行 update 非原子,中途失败留半成品状态 | 用 drizzle 事务(db.transaction)包裹;失败不 revalidate,前端 optimistic 自动回退 |
| `useOptimistic` 与 revalidate 顺序不一致导致闪动 | reducer 产出顺序 = action 写入顺序,保证一致;revalidate 后真实数据与乐观态相同 |
| 删 i18n key 漏改导致 `colSortOrder` 缺翻译报错 | zh-CN / en 同步删除;typecheck/lint 兜底 |
| paper 重启回弹(若忘改 bootstrap) | 验收单列「重启不回弹」用例 |

## 6. 兼容性与回滚

- **DB**:无 schema 变更,无迁移,存量 `sort_order` 值保留。✅
- **回滚**:revert 代码即可;`sort_order` 列与历史值不受影响,功能退回手填(但表单已删,回滚需连同表单恢复——属预期)。
- **依赖**:回滚时 `@dnd-kit/*` 可保留(无害)或一并卸载。
- **rollout**:后台管理功能,无灰度,直接上线。
- **用户端**:chat 工具栏下拉本就按 `asc(sortOrder)` 读,顺序自动跟随,无需改动。

## 7. 测试策略

- service `reorder*`:补单测(传入乱序 id → sortOrder 重写为 0..n、跳过不存在 id)。
- `create*` 默认末尾:单测(max+1)。
- bootstrap:若有现成 bootstrap 单测,更新断言(update 不再覆盖 sortOrder)。
- 前端 DnD:以手测为主(三处拖动落库、刷新保持、paper 重启不回弹、新建末尾)。
- 门槛:`pnpm check` + `pnpm test` 全绿。
