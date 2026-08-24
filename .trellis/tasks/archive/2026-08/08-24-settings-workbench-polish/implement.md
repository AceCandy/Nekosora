# 系统设置工作台顶级化 Implement Plan

## 1. 实施前基线

1. 完整读取即将修改的设置组件、双语 catalog 与现有测试。
2. 记录当前设置页定向测试基线；不启动产品服务。
3. 保留现有未提交评审快照，不修改或覆盖用户其他工作树内容。

## 2. 实施步骤

### Step A：导航与工作台骨架

1. 将 `SettingsTabs` 从 sticky 控制条改为普通文档流。
2. 复用现有 `useClickOutside`，补组合框 ARIA、方向键、Enter、Escape 和结果所属路径。
3. 在 `page.tsx` 建立 `xl` 双栏工作台；窄屏活动变更集进入普通顺序流。
4. 在 `output` 域增加两个现有锚点的二级目录和解释。

验证：四个顶层链接与旧 alias 不变；静态测试锁定搜索 ARIA、四域导航和输出二级入口；320px 结构不存在固定双条。

### Step B：活动变更集与发布影响

1. `SettingsChangeControl` 直接使用 `admin.settings.control` 与当前 locale。
2. 将发布历史从 absolute details 改为现有 `Modal`。
3. 在同文件实现最小差异展示投影，复用 core `changedFields`：领域、资源名、操作、字段、短值 before → after、长值折叠、确定性重点确认。
4. 活动草稿的 apply 入口移入发布审查 Modal；保留原 action/pending/error 语义。
5. 发布历史复用同一差异组件，保留无草稿时的反向撤销 form。

验证：一组覆盖 system setting、output mode、render style、创建、删除、长文本和治理策略的 fixture 能生成预期领域与重点确认；没有直接绕过审查的 apply submit。

### Step C：规范漂移修复

1. 修复设置页已确认的 `text-neutral-400` 信息文本，不修改纯装饰图标。
2. 修复直写 red 状态色与 `text-ui-subtitle`。
3. 输出模式/样式 Manager 与表单只改本轮评审命中的信息性文字 class。
4. 新增/修改输入声明合适的 `autoComplete`；保持现有 focus-visible 原语。

验证：定向 `rg` 不再命中本轮列出的无效 token/直写状态色；detector 无新增命中。

### Step D：双语与测试

1. 同步新增中英文设置工作台文案。
2. 扩展 `SettingsTabs.test.tsx`。
3. 新增 `SettingsChangeControl.test.tsx`，至少覆盖人类可读分组、创建/删除/修改、长内容和重点确认。
4. 运行定向测试、lint、typecheck、detector 和 `git diff --check`。

验证命令：

```bash
pnpm --filter @nekusora/web exec vitest run \
  "src/app/(dash)/admin/settings/SettingsTabs.test.tsx" \
  "src/app/(dash)/admin/settings/SettingsChangeControl.test.tsx" \
  "src/features/render-styles/RenderStylesManager.test.tsx"
pnpm --filter @nekusora/web lint
pnpm --filter @nekusora/web typecheck
node .agents/skills/impeccable/scripts/detect.mjs --json \
  'apps/web/src/app/(dash)/admin/settings' \
  apps/web/src/features/output-modes \
  apps/web/src/features/render-styles
git diff --check
```

## 3. 浏览器验收

如果 Web 能启动：

1. 以 320/390/768/1280px 检查无横向裁切和双 sticky 竞争。
2. 仅用键盘操作搜索、四域导航、输出二级目录、历史、发布审查和关闭 Modal。
3. 检查活动草稿、长 Prompt/CSS、删除、治理策略和发布历史的差异呈现。
4. 验证 apply/abandon/rollback 的 pending、成功和失败状态。
5. 检查触屏目标、focus-visible、Modal 滚动与内容溢出。
6. 验收后关闭所有本轮启动的服务。

若迁移账本问题仍阻断启动，记录原始错误；不得把源码和静态测试当作浏览器通过。

## 4. 独立复核门

- 使用 `trellis-check` 独立复核 PRD、设计 token、i18n、ARIA、Server Action 契约、测试和工作树保护。
- 检查每一处产品代码 diff 都能追溯到 R1-R4；不顺手重构邻近组件。
- 检查删除 labels 透传后没有 orphan i18n key/import/props。
- 检查 `applySettingsChangeSet` 仍只有审查 Modal 的真实提交入口，且反向撤销仍不允许活动草稿并存。

## 5. 回滚点

- Step A、B、C 可按文件回滚；均不改变数据模型。
- 若右栏在实际宽度下挤压内容，只回退 `xl` 网格为单列，不回退影响摘要与搜索改进。
- 若浏览器环境不可用，保留静态改进并明确标记真实验收待环境修复后补做。
