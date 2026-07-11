# 模型可见性分组排序实施计划

## 改动范围

- `src/db/schema/pg.ts`
- `src/db/schema/sqlite.ts`
- `drizzle/pg/*`
- `drizzle/sqlite/*`
- `src/app/(dash)/panel/actions.ts`
- `src/app/(dash)/panel/actions.test.ts`
- `src/app/(dash)/panel/models/page.tsx`
- `src/features/models/ModelsManager.tsx`
- `src/features/models/ModelFormDialog.tsx`
- `messages/zh-CN.json`
- `messages/en.json`

不修改 `/admin/models`、聊天组件或已有数据。

## 实施顺序

0. 扩展当前任务的数据模型边界。
   - 先写目录规范化/匹配失败测试与路由双模式探测测试。
   - 新增 `model_catalog` 双 dialect schema，删除 `models.vendor/capabilities`，增加 `models.catalogId` 外键并生成迁移。
   - 把所有模型查询的能力来源改为目录 join，同时保持上层 `capabilities` DTO 形状。
   - 模型表单删除厂商和能力编辑器，改为目录选择；创建支持自动匹配和显式模板覆盖。
   - `/v1/models.owned_by` 固定为 `nekusora`。

1. 为唯一管理员 migration 和 panel action 排序规则编写失败测试。
   - 覆盖第二个 admin 被 SQLite 拒绝、公开与私有重排隔离、发布追加、公开重名拒绝、新建公开末尾排序及编辑忽略 visibility。

2. 在 PG/SQLite schema 声明 `user_single_admin_unique_idx` partial unique index，并生成匹配的两份 migration 与 metadata。
   - 验证 migration SQL 仅创建 index，不包含数据迁移或自动降级逻辑。

3. 修改 `panel/actions.ts`。
   - 将 `reorderMyModels` 改为可见性分组签名。
   - 新增管理员专用的 `setMyModelVisibility`。
   - 让创建与编辑 action 遵守唯一的可见性变更入口及目标排序域。
   - 验证 action 测试通过。

4. 修改 `panel/models/page.tsx` 与 `ModelsManager.tsx`。
   - 页面绑定公开/私有 action。
   - 管理员模式渲染两个隔离拖拽表格，普通用户维持单表。
   - 可见性按钮和发布确认使用已有 `ConfirmDialog`。

5. 修改 `ModelFormDialog.tsx` 与中英文 i18n。
   - 编辑模式移除 visibility select，新增管理员模型保留初始选择。
   - 补齐分组、发布确认和操作文案。

6. 质量检查与独立复核。
   - 运行新增测试、`pnpm lint`、`pnpm typecheck`、`pnpm test`。
   - 确认 diff 未触及 `/admin/models`，不存在临时调试文件或历史兼容逻辑。
