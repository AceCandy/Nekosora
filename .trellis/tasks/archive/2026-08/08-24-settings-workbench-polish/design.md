# 系统设置工作台顶级化 Design

## 1. 核心方案

本任务只重构设置页的呈现与交互，不修改 settings-control 服务端契约：

```text
服务端 SettingsControlView / SettingsChange.before+after
  -> 设置页四域导航与搜索
  -> 当前域配置画布
  -> 活动变更集控制面
  -> 发布审查 Modal（人类可读差异）
  -> 现有 apply / abandon / rollback Server Actions
```

目标不是增加装饰，而是让上一任务已经实现的原子发布能力成为页面最清楚、最可信的产品语义。

## 2. 变更边界

### 当前行为与目标行为的最小差距

- 当前顶部导航和底部变更条同时 sticky；目标是任何视口只有一个工作台控制面占用固定位置。
- 当前输出模式/样式纵向相邻但没有二级路径；目标是不增加全局 Tab 的前提下明确行为与视觉两个工作区。
- 当前发布入口直接围绕 resource key 列表；目标是先展示按领域归组的确定性影响，再提交原有 apply action。
- 当前存在少量已确认 token、locale 和搜索 ARIA 漂移；目标是定向修正，不扩散到其他页面。

### 不改变的边界

- 不修改 `packages/core`、数据库 schema、迁移、治理采集、revision 或冲突算法。
- 不新增 API、客户端全局状态、依赖或第二套差异数据结构。
- 不改变四域 URL、旧 query alias、输出 CRUD、草稿持久化和反向撤销语义。
- 不生成没有历史数据依据的阈值推荐或风险概率。

## 3. 页面结构

```text
PageHeader
设置搜索
四域导航（普通文档流，不 sticky）

宽屏 xl：
┌──────────────────────────┬──────────────────┐
│ 当前设置域配置画布       │ 活动变更集       │
│                          │ revision / 历史  │
│                          │ 放弃 / 审查发布  │
└──────────────────────────┴──────────────────┘

窄屏：
活动变更集（普通顺序流）
当前设置域配置画布
```

- 页面内容使用 `xl:grid-cols-[minmax(0,1fr)_20rem]`；全局后台侧栏不变。
- `SettingsChangeControl` 在 `xl` 才使用 `sticky top-*`，窄屏置于内容前方且不吸附。
- `SettingsTabs` 删除 `sticky top-0`，保留桌面 Link 和移动端原生 select。
- 静止态无投影；只有原生 Modal 作为浮层保留现有遮罩/阴影语义。

## 4. 设置搜索

- `SEARCH_ITEMS` 继续是单一搜索元数据；顶层 Tab 元数据提取为同文件常量供导航与结果路径复用。
- 输入框使用 `role="combobox"`、`aria-autocomplete="list"`、`aria-expanded`、`aria-controls`、`aria-activedescendant`。
- 结果使用 `role="listbox"` / `role="option"`，显示“所属顶层域 / 设置名称”。
- ArrowDown/ArrowUp 循环选择，Enter 使用现有 router 跳转，Escape 只关闭结果，不破坏查询内容；点击外部复用 `useClickOutside`。
- 移动端顶层分类继续使用原生 `<select>`，不引入自定义选择器。

## 5. 输出体验二级目录

- 保留同一个 `output` 顶层域和现有 `#output-modes`、`#render-styles` 锚点。
- 在两个现有 Section 前增加一个轻量二级目录：
  - 行为模式：System Prompt，影响模型如何回答。
  - 视觉渲染：CSS + Markdown renderer，只影响展示。
- 目录使用普通锚点链接和可见说明，不新增 client state，也不复制 Manager 的 CRUD 或预览能力。

## 6. 活动变更集与发布审查

### 6.1 控制面

- 无草稿：显示当前 revision、首次编辑行为和发布历史入口。
- 有草稿：显示基准 revision、变更数量、服务端持久化说明、放弃和“审查并应用”。
- 历史从易被裁切的 absolute `<details>` 改为复用 `shared/ui/Modal`；时间通过当前 locale 的 `Intl.DateTimeFormat` 格式化。
- Action 状态继续使用 `useActionState`、`role="status"` / `role="alert"`；错误色统一为 `text-danger`。

### 6.2 人类可读差异

复用 core 的 `changedFields(change)`，在 `SettingsChangeControl.tsx` 内完成一次性展示投影：

- 领域：模型与任务、输出行为、视觉渲染、流量治理、网关协议。
- 资源名：system setting 使用固定允许键映射；输出模式/样式使用 snapshot 的 `name`，resource key 只作为次级技术标识。
- 操作：新增、删除、修改。
- 字段：忽略稳定 ID/namespace/key；其余字段使用 i18n 标签。
- 值：短标量显示 before → after；长 Prompt/CSS/JSON 默认只显示“内容已变更”，通过 `<details>` 按需展开完整值。
- 重点确认只基于确定事实：删除、治理策略、custom renderer 或 CSS 变更；不生成伪精确风险分数。

同一个差异组件同时用于：

1. 活动草稿的发布审查 Modal。
2. 发布历史详情。

发布按钮只存在于审查 Modal 内，继续提交原有 `applyAction`。`SettingsChangeControl` 以 draft ID/revision 作为 React key，发布或放弃后由 RSC 重载重置本地 Modal 状态。

## 7. 国际化与设计规范

- `SettingsChangeControl` 改用 `useTranslations("admin.settings.control")` 与 `useLocale()`，删除页面传入的大段扁平 labels，避免 namespace 漂移。
- 中英文目录同步新增：输出二级目录、差异领域/资源/字段、长内容、重点确认、审查确认文案。
- 信息性 hint/空态使用 `text-ink-tertiary` 或不低于规范的中性色；`text-neutral-400` 只保留在装饰图标。
- `text-ui-subtitle` 改为已定义的 `text-ui-subheading`。
- 状态色只用 `danger/success/warning` 语义 token。

## 8. 预计修改文件

- `apps/web/src/app/(dash)/admin/settings/page.tsx`：工作台网格、输出二级目录、移除 labels 透传。
- `SettingsTabs.tsx`：非 sticky、路径搜索、完整键盘/ARIA。
- `SettingsChangeControl.tsx`：右侧控制面、审查/历史 Modal、人类可读差异。
- `SettingsTabs.test.tsx`、新增 `SettingsChangeControl.test.tsx`：导航与差异投影回归。
- `apps/web/messages/en.json`、`zh-CN.json`：同步新增文案。
- 已确认使用信息性 `text-neutral-400` 或无效 token/直写状态色的设置页与输出 Manager 文件：只修改对应 class，不重排邻近代码。

## 9. 兼容、回滚与风险

- UI 改动可独立回退；Server Actions 与数据模型不变，不涉及数据回滚。
- 宽屏右栏会减少主画布宽度，只有 `xl` 启用；更窄视口保持单列，避免治理矩阵和输出表格被挤压。
- 长值可能很大，默认折叠并限制 Modal 内容滚动；不截断服务端数据，只控制默认展示。
- 本地 Web 仍可能被既有迁移账本问题阻断；静态检查通过不能替代最终浏览器验收，阻断时必须明确报告。
