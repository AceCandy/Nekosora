# 输出设置整合到系统设置 tab 并收敛记忆输出偏好

## Goal

把分散的「输出模式」「输出样式」两个独立管理页合并进「系统设置」页，以二级 tab 形式呈现；同时修正输出模式管理界面的编辑按钮文案 bug；并让长期记忆的 AI 自动抽取不再记录「输出呈现类偏好」(已由输出模式/输出样式承担)。

## Background

- 输出模式(`/admin/output-modes`)与输出样式(`/admin/render-styles`)各为独立一级路由 + 一级导航项,但本质都是「系统级输出配置」,与系统设置同域,分散入口增加认知成本。
- `OutputModesManager` 行内编辑按钮误用 `t("save")` 作文案,实际语义是「打开编辑弹窗」,应为「编辑」(对比 `RenderStylesManager` 同位置正确用 `t("edit")`)。
- 长期记忆 `buildExtractPrompt` 中 preference 定义含「语言、风格、格式等」,会把「回答简洁点 / 用 markdown / 用表格」这类输出呈现偏好抽进 preference,与输出模式/样式职责重叠,造成重复注入与潜在冲突。

## Requirements

### R1. 输出模式编辑按钮文案修正

- `OutputModesManager.tsx` 行内编辑按钮的 title 与文字由 `t("save")` 改为 `t("edit")`。
- 在 `messages` 的 `admin.outputModes` 命名空间下新增 `edit` 文案(zh-CN: 编辑; en: Edit)。
- 弹窗内真正的提交按钮(`OutputModeFormDialog` 的 `isEdit ? t("save") : t("createBtn")`)不动。

### R2. 输出模式 / 输出样式合并进系统设置 tab

- `/admin/settings` 改造为 tab 容器,三个 tab:**模型配置 / 输出模式 / 输出样式**。
- tab 切换走 URL `?tab=` + 纯 Link(对齐现有 `UsageTabs` 模式,服务端渲染,不引入 client state)。
- 默认 tab 为「模型配置」(即原 settings 首屏内容)。
- 删除独立路由 `/admin/output-modes`、`/admin/render-styles`(直接删,不做 redirect)。
- 移除 `nav-config.ts` 中 `globalManagementGroup` 的 `outputModes`、`renderStyles` 两个一级导航项。
- 两个 Manager 组件(`OutputModesManager`/`RenderStylesManager`)本身不改,仅搬进 settings。
- 各 tab 的 server action 内联在对应 section 组件中,`revalidatePath` 改为 `/admin/settings`。
- 数据按当前 tab 分支获取,不一次性查三份。

### R3. 长期记忆忽略输出呈现类偏好(AI 自动抽取)

- 仅改 `buildExtractPrompt`,新增规则:不抽取关于「回答呈现格式 / 回答风格 / 排版渲染」的偏好。
- 忽略范围:回答格式(markdown/纯文本/HTML/表格)、回答风格(简洁/详细/分点)、排版渲染(字体/配色/样式)。
- 保留范围:回答语言偏好、代码风格偏好、及其它与输出呈现无关的稳定偏好,仍正常抽取。
- 补 `extract.test.ts` 用例:含输出呈现偏好的对话 → 不产出该类 preference;含语言/代码风格偏好 → 仍产出。
- 存量记忆数据不清理;`/panel/memory` 手动入口不加限制;仅收敛 AI 自动抽取这一路。

## Acceptance Criteria

- [ ] AC1: 输出模式管理表格行内编辑按钮显示「编辑」,hover title 同;弹窗提交按钮仍为「保存」。
- [ ] AC2: `/admin/settings` 顶部 PageHeader 下方出现三个 tab,点击切换 URL 带 `?tab=`,服务端按 tab 渲染对应内容;默认 landed 在「模型配置」。
- [ ] AC3: `/admin/output-modes`、`/admin/render-styles` 路由已删除(访问 404,非 redirect)。
- [ ] AC4: 侧栏「全局管理」分组不再出现「输出模式」「输出样式」单项;「系统设置」项保留。
- [ ] AC5: 在「输出模式」「输出样式」tab 内,新增/编辑/启停/删除/拖动重排均可用,操作后回 `/admin/settings?tab=...` 且数据刷新。
- [ ] AC6: `buildExtractPrompt` 产出的 prompt 明确排除输出呈现类偏好;`extract.test.ts` 新增用例通过。
- [ ] AC7: `pnpm lint` / `pnpm typecheck` / 相关测试通过。

## Constraints

- 遵循 DESIGN.md「星枢天流」:tab 样式对齐 `UsageTabs`(无侧边彩色粗条、无 Eyebrow、静止无投影)。
- 不扩大范围:不泛化通用 Tabs 组件、不动 Manager 内部实现、不改记忆的其它 scope(profile/project)逻辑。
- i18n 双语同步(zh-CN + en)。
- 旧路由直接删,不保留 redirect。

## Out of Scope

- 记忆存量数据清理、手动新增入口的限制。
- 输出模式/样式的功能本身(增删字段、渲染器等)不变。
- 模型配置(ModelConfigSection)内部逻辑不变,仅搬进 tab。
