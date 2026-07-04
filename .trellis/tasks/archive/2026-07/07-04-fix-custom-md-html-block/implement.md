# Implement — 修复 custom 渲染器 HTML 块内文字被打散为段落

## 变更清单

1. `src/shared/components/markdown/customRenderer.ts` — 在 `parseMarkdown` 中新增 HTML 块嵌套深度追踪。
2. `src/shared/components/markdown/customRenderer.test.ts` — 新增单测，覆盖回归点。

## 执行步骤

### 1) 新增深度计算与 void 白名单

在 `customRenderer.ts` 顶部（`isHtmlLine` 附近）新增：

- `VOID_HTML_TAGS` 常量集合（`br/hr/img/input/meta/link/col/area/base/embed/param/source/track/wbr`）。
- `countHtmlDelta(line): number`：用正则 `/<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?>/g` 统计该行 HTML 标签净深度（自闭合与 void 计 0）。

### 2) 改造 `parseMarkdown` 主循环

- 新增局部变量 `let htmlBlockDepth = 0;`（与 `inCode`、`paragraph` 等并列）。
- 在 `inCode` 分支（`131-134`）之后、空行分支（`135`）之前插入：
  - 若 `htmlBlockDepth > 0`：`html += line + "\n"; htmlBlockDepth = Math.max(0, htmlBlockDepth + countHtmlDelta(line)); continue;`
- 在 `isHtmlLine` 分支（`142`）之前插入「开块」判定：
  - 计算 `const delta = countHtmlDelta(line);`
  - 若 `delta > 0 && trimmed.startsWith("<")`：先 `flushParagraph(); closeLists(); flushBlockquote();`，再 `htmlBlockDepth = delta; html += line + "\n"; continue;`
- 其余分支与 `isHtmlLine` 原逻辑保持不变。
- 不改 `flushParagraph` / `closeLists` / `flushBlockquote` / `parseTable` / `inlineMarkdown` / `escapeHtml`。

### 3) 新增单测 `customRenderer.test.ts`

用例（断言 `parseMarkdown(text)` 的 HTML 字符串）：

- [ ] 身份对照样本：输入 `design.md` 测试样本，三行正文「由 Z.ai… / 无实体… / 当前角色…」在输出中**不被 `<p>` 包裹**（断言不含 `<p>由 Z.ai`）。
- [ ] 嵌套容器：`<div><section>文字</section></div>` 输出中原样保留，文字无 `<p>`。
- [ ] void 标签不扰动深度：`<div>\n<br>\n<hr>\n文字\n</div>` 中文字不包 `<p>`。
- [ ] 同行开闭不进块：`<div>同行文字</div>` 走原 `isHtmlLine` 透传，不被当作块开始（后续普通 markdown 仍正常解析）。
- [ ] HTML 块结束后恢复解析：`<div>x</div>\n\n# 标题\n\n正文` 中「# 标题」仍解析为 `<h1>`、「正文」仍为 `<p>`。
- [ ] 普通 markdown 回归：标题 / 段落 / 无序有序列表 / 引用 / 代码块 / 表格 / hr 输出与改动前一致（快照式断言关键标记：`<h1>` / `<ul>` / `<ol>` / `<blockquote>` / `<pre><code>` / `<table>` / `<hr />`）。

### 4) 验证

- `pnpm typecheck` 通过。
- `pnpm test src/shared/components/markdown/customRenderer.test.ts` 全绿。
- `pnpm lint`（改动文件）无新增告警。

## Review Gate

- 单测全绿后，再 `pnpm dev` 用纸面杂志皮肤对身份对照 HTML 做肉眼验证：三行正文为浅灰（继承 `#cccccc`）、无 18px 行距、卡片布局完整。
- 同步抽查纸面杂志高级组件（`.takeaway` / `.card-grid` / `.compare-table-wrap`）未受影响。

## Rollback Point

- 改动集中在 `parseMarkdown` 单函数 + 一个新测试文件。
- 回滚：`git revert` 这两个文件，无连带迁移或数据变更。
