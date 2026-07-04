# 修复 custom 渲染器 HTML 块内文字被打散为段落

## Goal

让 `custom` 渲染器（`parseMarkdown`）正确处理 AI 输出的原生 HTML 块：位于 `<div>…</div>` 等 HTML 容器**内部**的裸文字行不再被当作 Markdown 段落重新包裹成 `<p>`，从而避免被输出样式（如纸面杂志 `p { color:#2a2a2a }`）改写颜色与边距。

## Background

- 纸面杂志皮肤配置 `renderer:"custom"`（`src/lib/infra/db/bootstrap.ts:330`），流式结束后走 `parseMarkdown`。
- 现状：`parseMarkdown` 逐行扫描，仅把「整行恰好是单个 HTML 标签」的行原样透传（`isHtmlLine`），HTML 块**内部**的纯文字行（不以 `<` 开头）会落入 `paragraph` 缓冲并被 `flushParagraph` 包成 `<p>`。
- 后果：示例 HTML 中「由 Z.ai 训练的大语言模型…」三行本在 `<div style="color:#cccccc">` 内，被打散为独立 `<p>`，命中 `.rs-paper .nekusora-md p { color:#2a2a2a; margin:18px 0 }`（`bootstrap.ts:534`），覆盖了 inline 的 `#cccccc` 并破坏布局。
- 默认 `streamdown` 渲染器不受影响（有真正的 HTML 解析器）。

## Requirements

- `parseMarkdown` 能识别 HTML 容器块的范围：进入块级容器开标签后，到对应闭标签之前，所有行（含裸文字、`<br>`、空行、嵌套标签）原样透传，不参与 Markdown 段落/列表/引用/表格解析。
- HTML 块内的文字保持其在原文中的位置，不被包成 `<p>`，也不被合并/改写。
- HTML 块结束后恢复正常的 Markdown 解析。
- 流式期间行为不变（流式仍走 streamdown，本改动只影响 `custom` 静态渲染）。
- 不改 `streamdown` 渲染路径、不改 `sanitizeHTMLStyle`、不改任何输出样式 CSS。

## Scope

- 仅改 `src/shared/components/markdown/customRenderer.ts` 的 `parseMarkdown`。
- 不改 `Markdown.tsx`、`streamdown-html.tsx`、`streamdown-style.ts`、`bootstrap.ts`、皮肤 CSS。

## Acceptance Criteria

- [ ] 输入「身份对照」示例 HTML（见 `design.md` 测试样本），三行正文「由 Z.ai… / 无实体… / 当前角色…」在最终 DOM 中**不出现 `<p>` 包裹**，颜色继承父 `<div style="color:#cccccc">`，在纸面杂志下显示为浅灰而非 `#2a2a2a`。
- [ ] 同一示例中，每个文字行之间不出现额外 18px 上下边距（即未被 `p { margin:18px 0 }` 命中）。
- [ ] 纸面杂志高级组件回归不破：`.takeaway` / `.note-box` / `.card-grid` / `.card` / `.opinion-card` / `.compare-table-wrap` 的典型示例仍能正确渲染（这些结构本身多以整行 HTML 标签出现，改动后行为不变）。
- [ ] 普通 Markdown（标题/段落/列表/引用/代码块/表格/水平线）渲染结果与改动前一致。
- [ ] 嵌套 HTML 容器（`<div><div>文字</div></div>`）内外层都正确透传。
- [ ] `<br>` / `<hr>` / `<img>` 等 void 标签不扰动块深度计数。
- [ ] `pnpm typecheck` 通过。

## Out of Scope

- 不修复纸面杂志 `em`/`strong`/`pre` 的强制样式覆盖（那是设计意图，用户可用 inline style 反制）。
- 不调整 `sanitizeHTMLStyle`（已在前序改动中改为原样透传）。
- 不更换纸面杂志的渲染器（仍为 `custom`）。
