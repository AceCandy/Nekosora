# 生成内容信任边界研究

## Confirmed Repository Facts

- `apps/web/src/lib/render-styles/service.ts:29-40,91-167`：render style 的列表、创建、更新、排序和删除写入口均由 `requireAdmin()` 保护。
- `packages/core/src/lib/infra/db/bootstrap.ts:655-684`：内置 `paper` 预设显式使用 `renderer: "custom"`；普通创建 action 未传 renderer，数据库默认是 `streamdown`。
- `apps/web/src/app/(dash)/admin/settings/RenderStylesSection.tsx:20-30`：服务端 DTO 当前丢弃 renderer，管理 UI 无法标识 custom。
- `apps/web/src/shared/components/markdown/customRenderer.ts:1-6,557-571` 与 `Markdown.tsx:922-930`：custom 路径原样保留模型 HTML/class/style，并进入主 DOM。
- `packages/core/src/lib/artifacts/extract.ts:34-81`：SVG/HTML artifact 来自 assistant fenced code block，不经过管理员配置。
- `apps/web/src/features/artifacts/ArtifactPanel.tsx:123-128`：SVG 当前直接进入主 DOM；HTML 进入 `HtmlPreviewFrame`。
- `apps/web/src/features/artifacts/html-preview.ts:54-112`：HTML iframe 使用 CSP 与 `sandbox="allow-scripts"`，不含 `allow-same-origin`。
- `apps/web/src/features/artifacts/HtmlPreviewFrame.tsx:61-66`：外部打开会把同一模型内容写成顶层 Blob 文档，脱离 iframe sandbox。
- `HtmlPreviewFrame` 当前只有 `ArtifactPanel` 一个调用方；面板工具栏已经提供复制和下载。

## User Decisions

- custom renderer 和管理员 CSS 保持当前原样渲染/注入行为。
- 只在管理配置处根据 `renderer === "custom"` 给出非阻断提醒，不增加保存拦截、确认弹窗或规则扫描器。
- custom renderer 的未净化 HTML 风险由产品明确接受并写入安全文档。
- SVG/HTML artifact 不属于管理员前置审查范围，应继续可预览，但不能脱离 sandbox 在应用主源执行。

## Minimal Implementation Consequence

- 管理 DTO 透传已有 renderer；列表加 warning Badge，custom 编辑表单加 `role="note"` 说明，CSS hint 补充分享影响。
- SVG 复用 `HtmlPreviewFrame`；删除该组件的 Blob/`window.open` 入口，不新增依赖或新预览组件。
- 测试守住提醒的非阻断性质、iframe sandbox、主 DOM SVG 移除和中英文文案同步。
