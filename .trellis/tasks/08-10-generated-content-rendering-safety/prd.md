# 生成内容渲染安全

## Goal

保留管理员受信配置下的 custom renderer 与完整 CSS 能力，同时让管理员清楚其信任边界，并把不属于管理员配置范围的模型 artifact 隔离在主页面源之外。

## Background

- `apps/web/src/shared/components/markdown/customRenderer.ts:1-6,557-571` 明确原样保留模型 HTML/class/style，`Markdown.tsx:922-930` 将结果写入 `dangerouslySetInnerHTML`。
- custom renderer 当前仅由内置“纸面杂志”预设启用；render style 的创建、编辑、启停和删除均由 `requireAdmin()` 保护，普通新建样式默认使用 Streamdown。
- `apps/web/src/features/artifacts/ArtifactPanel.tsx:123-128` 对模型生成的 SVG artifact 直接写入主 DOM；该内容来自 assistant fenced code block，不属于管理员配置。
- HTML artifact 在 iframe 内使用 opaque-origin sandbox，但 `HtmlPreviewFrame.tsx:61-66` 的“新窗口打开”会把内容写入顶层 Blob 文档，不再受 iframe sandbox 约束。
- `apps/web/src/app/share/[shareId]/page.tsx:28,42-47` 会应用管理员样式快照与 custom renderer；这是管理员选择该渲染方式后的既有行为。

## Confirmed Decisions

- D1. custom renderer 保持当前原样渲染语义，不增加 HTML/SVG 属性白名单、DOM sanitizer 或 CSP 拦截。
- D2. 管理员 CSS 保持原样注入，不增加 CSS parser、危险规则拦截、确认勾选或保存阻断。
- D3. 风险通过管理端显式、非阻断提醒和安全文档进行人为管控；提醒不得妨碍编辑、启用和保存。
- D4. SVG/HTML artifact 是模型内容，不受管理员配置前置审查保护，仍需保持可预览但不能脱离 sandbox 在应用主源执行。

## Requirements

- R1. `RenderStyle` 管理 DTO 必须包含 `renderer`，管理列表对 `custom` 样式显示持续可见的高信任标识。
- R2. 编辑 custom 样式时，在表单内显示非阻断说明：模型 HTML 会原样渲染，并会用于公开分享；管理员应只在模型与内容来源可控时启用。
- R3. CSS 编辑提示必须明确 CSS 会原样应用于聊天页和公开分享；不新增规则扫描、弹窗确认或保存拦截。
- R4. custom renderer 的渲染结果、输出样式 class、会话选择、流式结束切换和分享快照行为保持兼容。
- R5. SVG artifact 改为复用现有 `HtmlPreviewFrame` 的 iframe、CSP 与 opaque-origin sandbox，不再直接注入主 DOM。
- R6. 移除 artifact 预览中脱离 sandbox 的顶层 Blob 打开入口；现有复制和下载能力保留，HTML/SVG 仍可在隔离预览中查看。
- R7. 增加管理提醒、renderer DTO、SVG sandbox 与外部打开移除的定向测试；默认 Streamdown 和 HTML artifact 预览继续回归。
- R8. 同步 SECURITY 与 Markdown/render-style Trellis 契约，如实记录 custom renderer 是管理员主动启用的未净化信任边界，不能再宣称所有 assistant 内容均已净化。

## Acceptance Criteria

- [ ] custom renderer 与管理员 CSS 的现有输出结果保持不变，保存和启停不增加阻断步骤。
- [ ] 管理列表能识别 custom 样式，编辑时能看到明确、可读、非阻断的风险说明；中英文文案同步。
- [ ] SVG artifact 不再通过 `dangerouslySetInnerHTML` 进入主 DOM，而是在不含 `allow-same-origin` 的 sandbox 中渲染。
- [ ] HTML/SVG artifact 不再提供脱离 sandbox 执行的顶层打开入口，复制和下载仍可用。
- [ ] SECURITY 和代码规范明确记录被接受的 custom renderer 剩余风险及管理员责任。
- [ ] 定向测试、`pnpm check`、`pnpm test` 与独立安全复核通过。

## Out Of Scope

- 净化、重写或禁用 custom renderer。
- 限制管理员 CSS 语法、选择器、外连或样式作用域。
- 为风险提醒实现 CSS/HTML 规则引擎、确认弹窗或审计审批流。
- 重设计输出样式管理界面、恢复暗色主题或重写 Mermaid。

## Accepted Residual Risk

- 管理员启用 custom renderer 后，模型输出中的原生 HTML、事件属性或脚本仍可能在聊天页和公开分享页的应用源中执行。非阻断提醒只能帮助管理员判断是否启用，不能提供技术隔离；该风险由产品决策明确接受。
