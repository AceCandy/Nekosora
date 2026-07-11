# 模型可见性分组排序设计

## 范围

产品入口是 `/panel/models`。管理员只有一个，因此该页面中的公开模型排序天然是全局唯一顺序；普通用户仍只管理自己的私有模型。`/admin/models` 没有导航入口，本次不修改。

本次同时增加数据库级唯一管理员约束。项目未上线且当前仅有一名管理员，不提供多管理员数据的修复或兼容逻辑。

## 模型目录与厂商字段

彻底删除 `models.vendor` 及其表单、DTO、Action 和 API 读取；OpenAI 兼容 `/v1/models` 的 `owned_by` 固定返回 `nekusora`。

新增双 dialect 同构的 `model_catalog` 表，保存 `canonicalModelId`、`aliases`、`modelType`、`capabilities`、`defaultParams`、上下文与最大输出长度、启停和排序字段。`models.catalogId` 引用目录，业务查询通过 join 将目录能力继续投影为既有 DTO 的 `capabilities`，因此聊天、推理和多模态消费者不维护第二套能力来源。

目录匹配只使用规范化后的标准名和显式别名，不执行数据库正则。创建模型时显式 `catalogId` 优先，否则按模型名自动匹配；无法匹配时拒绝创建并要求选择目录。模型表单只允许选择目录，不再编辑能力 JSON。修改目录记录后所有引用模型实时读取新值。

流式/非流式兼容性不进入目录。路由测试先保留非流式探测，并在非鉴权、非网络失败时追加流式探测；任一模式成功即路由可用，结果明确标注各模式状态。

## 唯一管理员约束

`user` 表在 PostgreSQL 与 SQLite schema 中增加同名 partial unique index：

```sql
CREATE UNIQUE INDEX user_single_admin_unique_idx
ON "user" (role)
WHERE role = 'admin';
```

SQLite 使用等价的 quoted identifier 语法。该索引仅收录 `role='admin'` 的行，故允许任意数量普通用户，且最多一条管理员记录。两份 Drizzle schema 都声明该 index，并通过生成的 PG/SQLite migration 创建它。

不在 application 层维护第二套“是否已有管理员”的检查：数据库约束是唯一权威，可覆盖 bootstrap、seed 和直接数据库写入。由于没有存量兼容需求，已有多管理员时 migration 直接失败。

## 模型排序域

| 场景 | 排序域 | 写入条件 |
| :--- | :--- | :--- |
| 普通用户 | 自己的 private 模型 | `ownerUserId=user.id` 且 `visibility=private` |
| 唯一管理员私有组 | 管理员自己的 private 模型 | 同上 |
| 唯一管理员公开组 | 全部 public 模型 | `visibility=public` 且 `ownerUserId=user.id` |

`getVisibleModels()` 继续按 `sortOrder, createdAt` 查询后稳定地将私有模型放在公开模型前，因而无需修改聊天端。

## Panel Server Actions

修改 `panel/actions.ts`，不改 admin actions：

- `reorderMyModels(visibility, orderedIds)` 按该可见性组重写连续 `sortOrder`。私有分组带 owner 条件；公开分组带 public 和 owner 条件。PG 使用异步事务；SQLite 使用同步 `.run()` 事务，避免 better-sqlite3 拒绝 Promise 回调。
- `setMyModelVisibility(id, visibility)` 仅允许管理员调用。它校验模型 owner、发布时公开名称唯一性，在目标排序域取最大值后一次性更新 `visibility` 与 `sortOrder`。该操作为单条更新，不使用 SQLite 不兼容的异步事务回调。
- `createMyModel()` 使用初始可见性选择目标排序域的最大 `sortOrder`，新建项追加到对应组末尾。
- `updateMyModel()` 不再读取或写入 `visibility`；当既有模型为 public 时仍校验改名后的公开名称唯一性。

所有排序与可见性写入均执行 `/panel` layout revalidation；多条排序写入按数据库方言保持事务原子性。

## 管理界面

`ModelsManager.tsx` 在 `isAdmin` 为真时将输入顺序拆成私有和公开两个独立表格，每张表各有独立 `DndContext` 与 `SortableContext`，因此不能跨组拖放。两个 `DndContext` 分别传 `models-private-sortable` 与 `models-public-sortable` 作为稳定 id，避免 dnd-kit 模块级自增 ID 在 SSR/hydration 时不一致。普通用户维持当前单表和 `reorderMyModels("private", ids)` 行为。

可见性单元格由静态 Badge 改为按钮：

- 私有按钮打开 `ConfirmDialog`，确认后提交绑定 `setMyModelVisibility(id, "public")` 的 action。
- 公开按钮直接提交绑定 `setMyModelVisibility(id, "private")` 的 action。
- `ModelFormDialog` 的可见性 select 仅在新增管理员模型时显示，编辑模式不显示，避免绕过发布确认。

`panel/models/page.tsx` 预先绑定两种可见性 action 并传入 `ModelsManager`。`messages/zh-CN.json` 与 `messages/en.json` 的 `models` namespace 增加分组标题和发布确认文案。

## 验证与回滚

- 使用 SQLite 临时数据库或 bootstrap migration test 验证 partial unique index 拒绝第二个管理员。
- 为 panel actions 增加内存 Drizzle mock 测试：公开/私有组重排、发布追加、重名公开发布失败、新建公开模型追加、编辑忽略伪造 visibility。
- 手工验证唯一管理员在 `/panel/models` 的两个分组、发布确认、公开收回、聊天端顺序，以及浏览器控制台无 hydration warning。
- 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。
- 回滚时删除新 migration、移除 schema index 与 panel 分组调用；未上线环境不保留数据兼容处理。
