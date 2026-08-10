# 生成内容渲染安全实施计划

## Success Gate

- custom renderer 与管理员 CSS 行为保持不变，只增加非阻断提醒。
- SVG/HTML artifact 不能通过预览路径在应用主源中执行模型内容。
- 定向测试、全量门禁和独立复核通过。

## Affected Files

- `apps/web/src/app/(dash)/admin/settings/RenderStylesSection.tsx`
- `apps/web/src/features/render-styles/RenderStyleFormDialog.tsx`
- `apps/web/src/features/render-styles/RenderStylesManager.tsx`
- `apps/web/src/features/artifacts/ArtifactPanel.tsx`
- `apps/web/src/features/artifacts/HtmlPreviewFrame.tsx`
- `apps/web/src/features/artifacts/html-preview.ts`
- `apps/web/messages/zh-CN.json`
- `apps/web/messages/en.json`
- `SECURITY.md`
- `.trellis/spec/frontend/component-guidelines.md`
- 对应新增定向测试文件

## Phase 0: Baseline And Tests

- [x] 记录当前定向测试基线，确认没有既存 render-style/artifact 组件测试可复用。
- [x] 为 custom/streamdown 管理提醒差异补失败测试。
- [x] 为 SVG iframe sandbox 与外部打开入口移除补失败测试。
- [x] 测试只断言可观察契约，不复制组件内部实现。

验证：

```bash
pnpm --filter @nekusora/web test -- RenderStyle Artifact html-preview
```

## Phase 1: Admin Trust Warning

- [x] `RenderStylesSection` 投影已有 `renderer` 字段。
- [x] `RenderStyle` 客户端类型增加 `renderer`，不得用 cast 隐藏缺失字段。
- [x] custom 行复用 warning Badge 显示高信任标识。
- [x] custom 编辑表单显示 `role="note"` 的非阻断风险说明。
- [x] 更新 CSS 提示，明确聊天页与公开分享影响。
- [x] 中英文文案同步；不增加确认状态、解析器或 server action 参数。

回滚点：以上改动仅为 DTO 与展示，可整体回滚且不影响数据库内容。

## Phase 2: Artifact Isolation

- [x] SVG 分支改用现有 `HtmlPreviewFrame`，删除主 DOM `dangerouslySetInnerHTML`。
- [x] 从 `HtmlPreviewFrame` 删除 Blob URL、`window.open`、ExternalLink import 和外部打开按钮。
- [x] 保留 iframe `srcDoc`、CSP、高度 bridge、lazy loading、复制和面板下载能力。
- [x] 断言 sandbox 不含 `allow-same-origin`，且 HTML/SVG 两条分支均走隔离预览。

回滚点：若 SVG 视觉异常，先修复 iframe 容器尺寸；只有在记录剩余安全风险后才能临时回滚 SVG 分支。

## Phase 3: Contract Alignment

- [x] 更新 `SECURITY.md`：默认 Streamdown/HTML artifact 的防护与 custom renderer 的管理员受信例外分别描述。
- [x] 更新 Markdown/render-style 前端规范，记录提醒位置、非阻断语义和被接受的剩余风险。
- [x] 检查注释不再笼统声称所有 assistant 内容都已净化。

## Phase 4: Verification

- [x] 运行定向 Web 测试。
- [x] 运行 `pnpm check`。
- [x] 运行 `pnpm test`。
- [x] 检查可用登录态：新浏览器会话被重定向到 `/login`，未执行需认证页面的视觉验收；浏览器会话已关闭，既有开发服务未改动。
- [x] 独立复核 custom 行为未被拦截、SVG 已隔离、顶层 Blob 入口已移除。
- [x] `git diff --check`，确认无临时截图、缓存或调试文件。

## Execution Record

- 失败基线：3 个新增测试文件中 5 个用例按预期失败，分别命中管理提醒、SVG 主 DOM 注入和外部打开入口。
- 定向验证：`pnpm --filter @nekusora/web exec vitest run ...`，3 个文件 8 个测试通过。
- 全量门禁：`pnpm check` 通过；`pnpm test` 全工作区通过。
- 独立复核发现 Artifact 测试 mock 了隔离边界；已改为穿过真实 `HtmlPreviewFrame`/`buildHtmlPreviewDoc`，并补 CSP 断言后复测通过。

## Non-Goals During Implementation

- 不引入 sanitizer、CSS parser、CSP 中间件或新依赖。
- 不新增 renderer 选择器、审批流、确认弹窗或审计表。
- 不顺带清理暗色样式、管理表格或 Artifact 组件的其他历史代码。
