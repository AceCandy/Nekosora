# 技术设计

## 总览

三个独立改动,低耦合,可顺序实现:

| 改动 | 影响面 | 风险 |
|---|---|---|
| R1 文案修正 | `OutputModesManager.tsx` + 两个 messages 文件 | 极低 |
| R2 settings tab 化 | settings 目录重构 + 删两路由 + nav-config | 中(路由/导航变更) |
| R3 记忆 prompt 收敛 | `extract.ts` + `extract.test.ts` | 低 |

---

## R1. 输出模式编辑按钮文案

**文件**: `src/features/output-modes/OutputModesManager.tsx:242-251`

行内编辑按钮当前:
```tsx
title={t("save")}
...
<span>{t("save")}</span>
```
改为 `t("edit")`(title + 文字两处)。

**i18n**: `admin.outputModes` 命名空间下新增 `edit`。
- zh-CN: `"edit": "编辑"`
- en: `"edit": "Edit"`

弹窗内 `OutputModeFormDialog.tsx:121` 的 `isEdit ? t("save") : t("createBtn")` 不动(那是真正的保存提交)。

---

## R2. 系统设置 tab 化

### 目标结构

```
src/app/(dash)/admin/settings/
├── page.tsx                  # tab 容器:读 ?tab=,渲染 PageHeader + SettingsTabs + 当前 section
├── SettingsTabs.tsx          # 新建:三 tab 链接条(复用 UsageTabs 样式)
├── ModelConfigSection.tsx    # 已有,不动
├── OutputModesSection.tsx    # 新建:async server component,含数据获取 + 5 个 action + 渲染 OutputModesManager
└── RenderStylesSection.tsx   # 新建:async server component,含数据获取 + 5 个 action + 渲染 RenderStylesManager
```

### page.tsx 改造

- 保留 `export const dynamic = "force-dynamic"`。
- 接收 `searchParams: Promise<Record<string, string | string[] | undefined>>`(Next 15 写法,参考 `panel/usage/page.tsx`)。
- 解析 tab:`tab ∈ {"model" | "output-modes" | "render-styles"}`,非法/缺省 → `"model"`。
- 渲染:
  ```tsx
  <div className="space-y-8">
    <PageHeader icon={Settings} title={tn("settings")} desc={t("desc")} />
    <SettingsTabs current={tab} />
    {tab === "model" && <ModelConfigSection labels={{...}} />}
    {tab === "output-modes" && await OutputModesSection()}
    {tab === "render-styles" && await RenderStylesSection()}
  </div>
  ```
- 各 section 为 async server component,自行取数 → 只查当前 tab 数据。

### SettingsTabs.tsx

- 纯 Link 组件(无 "use client"),`?tab=` 切换,服务端重新渲染。对齐 `UsageTabs.tsx` 样式与交互。
- 三 tab:`model` / `output-modes` / `render-styles`,label 取 `admin.settings.tabs.*`。
- `prefetch={false}`(与 UsageTabs 一致,避免预取带参数 URL)。

### OutputModesSection / RenderStylesSection

- 把原 `output-modes/page.tsx`、`render-styles/page.tsx` 的逻辑整体搬入:
  - 数据获取(`listAllOutputModes` / `listAllRenderStyles` + 字段映射)
  - 5 个 server action(create/update/toggle/delete/reorder)
  - `updateActions`/`toggleActions`/`deleteActions` 的 `Object.fromEntries` 构造
  - 渲染 `<OutputModesManager>` / `<RenderStylesManager>`
- **唯一改动**:`revalidatePath` 从各自旧路径改为 `"/admin/settings"`。
- tab 内不再放 `PageHeader`(settings 顶部已有),直接渲染 Manager。

### 路由删除

- 删除 `src/app/(dash)/admin/output-modes/` 目录(整个)。
- 删除 `src/app/(dash)/admin/render-styles/` 目录(整个)。
- 不保留 redirect,访问直接 404(用户已确认)。

### 导航

`src/shared/nav-config.ts` 的 `globalManagementGroup.items` 移除:
```ts
{ href: "/admin/output-modes", labelKey: "outputModes" },
{ href: "/admin/render-styles", labelKey: "renderStyles" },
```
保留 `users` / `operations` / `settings` 三项。

> 副作用:侧栏数字快捷键序号随后续项位移(users/operations/settings 的 hotkey 各前移 2)。快捷键本就位置相关,可接受。

### i18n

`admin.settings` 命名空间下新增 `tabs`:
- zh-CN: `tabs.model`(模型配置) / `tabs.outputModes`(输出模式) / `tabs.renderStyles`(输出样式)
- en: 同结构英文

`nav.outputModes` / `nav.renderStyles` 两个 key 不删(chat 工具栏或其它处可能引用),仅 nav-config 不再引用。

### 不变项

- `OutputModesManager` / `RenderStylesManager` 组件内部不动。
- service 层(`src/lib/output-modes/service.ts`、`src/lib/render-styles/service.ts`)不动。
- chat 工具栏读取输出模式/样式的链路不动。
- `ModelConfigSection` 内部不动。

---

## R3. 记忆 prompt 收敛

**文件**: `src/lib/memory/extract.ts:147` `buildExtractPrompt`

在 prompt 的「规则」段新增一条:

> - 不要提取关于「回答呈现」的偏好(回答格式如 markdown/纯文本/HTML/表格、回答风格如简洁/详细/分点、排版渲染如字体/配色/样式)。这些由系统设置的「输出模式」「输出样式」管理,不属于长期记忆范畴。

同时把 preference 的字段说明从「语言、风格、格式等」收敛为「语言、代码风格等与回答呈现无关的稳定偏好」,避免 prompt 内部矛盾。

### 边界(写入 PRD 验收)

| 偏好类型 | 处理 | 依据 |
|---|---|---|
| 回答格式(markdown/HTML/表格) | 忽略 | 输出模式覆盖 |
| 回答风格(简洁/详细/分点) | 忽略 | 输出模式覆盖 |
| 排版渲染(字体/配色) | 忽略 | 输出样式覆盖 |
| 回答语言(中/英) | 保留 | 输出模式/样式不覆盖语言 |
| 代码风格(缩进/注释) | 保留 | 内容偏好,非呈现 |

> 语言/代码风格为初版判断;prompt 用自然语言描述边界,不靠关键词硬过滤(避免误伤)。如后续需收紧,再讨论。

### 测试

`src/lib/memory/extract.test.ts` 补两条用例(测 `buildExtractPrompt` 产出 + `parseExtracted` 容错,或直接断言 prompt 文本含排除规则):
- 用例 A:对话含「以后回答都用 markdown 表格」「回答简洁点」→ prompt 含排除规则(或 mock LLM 返回后断言该类不被采纳)。
- 用例 B:对话含「用中文回答」「代码用 tab 缩进」→ 不被排除规则影响,仍可产出。

> 实现时优先沿用该测试文件现有风格(看是否 mock streamChat)。若现有用例直接测 `buildExtractPrompt` 字符串,新增同风格断言即可。

### 不变项

- `parseExtracted` 不加关键词过滤。
- service 层(preference 写入/注入)不动。
- 存量数据不清理、手动入口不加限制。

---

## 兼容性 / 回滚

- R2 删路由后外部书签 404(已确认接受)。
- 整体一个 commit;回滚 `git revert` 即可恢复两路由目录与 nav。
- nav 快捷键序号位移为可接受副作用。
- 数据层无变更,无迁移。
