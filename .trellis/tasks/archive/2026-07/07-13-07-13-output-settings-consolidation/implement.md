# 执行计划

> 验证命令以 `package.json` scripts 实际为准;默认 `pnpm lint` / `pnpm typecheck` / `pnpm test`。

## Phase A — R1 文案修正

- [ ] A1. `messages/zh-CN.json` + `messages/en.json`:`admin.outputModes` 下新增 `edit`(zh: 编辑 / en: Edit)。
- [ ] A2. `src/features/output-modes/OutputModesManager.tsx:247,250`:行内编辑按钮 `title` 与 `<span>` 文字 `t("save")` → `t("edit")`。
- [ ] A3. 验证:`pnpm typecheck` + `pnpm lint`。

**Review gate**: 弹窗提交按钮仍为「保存」,行内按钮为「编辑」。

## Phase B — R3 记忆 prompt 收敛

- [ ] B1. `src/lib/memory/extract.ts` `buildExtractPrompt`:
  - 规则段新增「不提取回答呈现类偏好(格式/风格/排版)」一条。
  - preference 字段说明由「语言、风格、格式等」收敛为「语言、代码风格等与回答呈现无关的稳定偏好」。
- [ ] B2. `src/lib/memory/extract.test.ts`:沿用现有风格补用例(排除呈现类偏好 / 保留语言与代码风格)。
- [ ] B3. 验证:`pnpm test src/lib/memory/extract.test.ts` + `pnpm typecheck`。

**Review gate**: prompt 文本含排除规则;新用例通过;`parseExtracted` 未加硬过滤。

## Phase C — R2 settings tab 化

- [ ] C1. 新建 `src/app/(dash)/admin/settings/SettingsTabs.tsx`:三 tab Link 条,样式对齐 `UsageTabs`,`prefetch={false}`,label 取 `admin.settings.tabs.*`。
- [ ] C2. 新建 `src/app/(dash)/admin/settings/OutputModesSection.tsx`:async server component,搬入原 `output-modes/page.tsx` 的数据获取 + 5 action + Manager 渲染;`revalidatePath("/admin/settings")`。
- [ ] C3. 新建 `src/app/(dash)/admin/settings/RenderStylesSection.tsx`:同上,搬入原 `render-styles/page.tsx`。
- [ ] C4. 改 `src/app/(dash)/admin/settings/page.tsx`:接 `searchParams`,解析 `tab ∈ {model, output-modes, render-styles}`(缺省 `model`),渲染 PageHeader + SettingsTabs + 对应 section。保留 `dynamic = "force-dynamic"`。
- [ ] C5. 删除 `src/app/(dash)/admin/output-modes/` 与 `src/app/(dash)/admin/render-styles/` 两个目录。
- [ ] C6. `src/shared/nav-config.ts`:`globalManagementGroup.items` 移除 `outputModes`、`renderStyles` 两项。
- [ ] C7. `messages/zh-CN.json` + `messages/en.json`:`admin.settings.tabs` 下加 `model` / `outputModes` / `renderStyles`。
- [ ] C8. 验证:`pnpm typecheck` + `pnpm lint`。

**Review gate**: 三 tab 切换 URL 带 `?tab=`;旧路由 404;侧栏无两项;tab 内 CRUD + 拖动可用。

## Phase D — 全量验证

- [ ] D1. `pnpm lint`。
- [ ] D2. `pnpm typecheck`。
- [ ] D3. `pnpm test`(至少 memory 相关)。
- [ ] D4. 自查 diff:每行可追溯到 PRD 某条需求;无顺手重构。
- [ ] D5. (可选)本地启动确认 settings 三 tab 与输出模式/样式 CRUD 实际可用。

## Rollback Points

- A、B 各自独立,可单独 revert。
- C 整体一个 commit 便于 `git revert` 恢复两路由目录与 nav-config。
