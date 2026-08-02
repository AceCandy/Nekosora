/**
 * 自定义 Markdown 渲染器 —— 用于「输出样式」选 custom 渲染器时的静态渲染。
 *
 * 流式期间仍用 streamdown(支持增量解析),流式结束后切换到本渲染器以应用完整的
 * 自定义 CSS(含 class 选择器,如 .takeaway/.card 等高级组件)。原样保留 AI 输出的
 * HTML/class/style,不做过滤(信任 AI 输出,由调用方保证会话可信)。
 */

import { resolveStructuredKind } from "@/lib/artifacts/structured";
import { resolvePreviewableKind } from "@/lib/artifacts/previewable";
import type { StructuredKind } from "@/shared/components/structured-blocks/schema";

/** 混合渲染分段:结构化块(chart/metric/table)、mermaid 图、普通代码块与 markdown 文本分别处理。 */
export type StructuredSegment =
  | { type: "structured"; kind: StructuredKind; raw: string }
  | { type: "mermaid"; raw: string }
  | { type: "code"; language: string; raw: string }
  | { type: "markdown"; text: string };

/**
 * 将 markdown 文本按结构化代码块切成段。
 * 结构化段交由 React 受控组件渲染,markdown 段仍走 parseMarkdown;
 * fenced code block 天然是 markdown 块分隔符,切分不会破坏两侧结构。
 */
export function splitStructuredSegments(input: string): StructuredSegment[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const segments: StructuredSegment[] = [];
  let markdown: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];

  function flushMarkdown() {
    if (markdown.length && markdown.join("\n").trim()) {
      segments.push({ type: "markdown", text: markdown.join("\n") });
    }
    markdown = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeBuffer = [];
      } else {
        const raw = codeBuffer.join("\n");
        const kind = resolveStructuredKind(codeLang);
        if (kind) {
          flushMarkdown();
          segments.push({ type: "structured", kind, raw });
        } else if (resolvePreviewableKind(codeLang, raw) === "mermaid") {
          // mermaid 块:custom 渲染器路径不走 MarkdownCodeBlock,在此单独切出,
          // 交由 MermaidInlineBlock 内联渲染(与默认渲染器一致),否则会退化成纯源码。
          flushMarkdown();
          segments.push({ type: "mermaid", raw });
        } else {
          // 其余非结构化代码块单独切段,交由 MarkdownImpl 用 Streamdown 渲染
          // (Shiki 高亮 + 块状,与默认渲染器一致),不归入 markdown 段。
          flushMarkdown();
          segments.push({ type: "code", language: codeLang, raw });
        }
        inCode = false;
        codeLang = "";
        codeBuffer = [];
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
    } else {
      markdown.push(line);
    }
  }
  flushMarkdown();
  // 未闭合代码块(custom 仅非流式调用,理论不出现):兜底当 markdown。
  if (inCode) {
    segments.push({ type: "markdown", text: ["```" + codeLang, ...codeBuffer].join("\n") });
  }
  return segments;
}

/** HTML 转义(代码块内容用)。 */
function escapeHtml(str: string): string {
  return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(str: string): string {
  return escapeHtml(str).replaceAll('"', "&quot;");
}

/** 阻止 GFM 裸链接把紧跟在右括号后的中文正文误识别为 URL。 */
export function separateBareUrlTrailingText(input: string): string {
  let inCodeBlock = false;
  return input
    .split("\n")
    .map((line) => {
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (inCodeBlock) return line;
      return line
        .split(/(`[^`]*`|\[[^\]]+\]\([^)]+\)|<[^>]*>)/g)
        .map((part, index) => index % 2 === 0
          ? part.replace(/(https?:\/\/[^\s<>()]+)\)(?=[\u3400-\u9fff])/g, "$1)<!-- -->")
          : part)
        .join("");
    })
    .join("\n");
}

/** 行内 Markdown:加粗/斜体/行内代码/链接。 */
function inlineMarkdown(str: string): string {
  const protectedFragments: string[] = [];
  const protect = (html: string) => {
    const index = protectedFragments.push(html) - 1;
    return `\u0000FRAGMENT${index}\u0000`;
  };
  const withProtectedFragments = str
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, (_, code: string) => protect(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) =>
      protect(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`));

  return withProtectedFragments
    .replace(/https?:\/\/[^\s<]+/g, (value) => {
      let href = value.replace(/[.,;:!?]+$/, "");
      while (href.endsWith(")") && href.split(")").length > href.split("(").length) {
        href = href.slice(0, -1);
      }
      const trailing = value.slice(href.length);
      return `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>${trailing}`;
    })
    .replace(/\u0000FRAGMENT(\d+)\u0000/g, (_, index: string) => protectedFragments[Number(index)]);
}

/** 判断一行是否为 HTML 块(整行是单个标签开闭)。 */
function isHtmlLine(line: string): boolean {
  const trimmed = line.trim();
  return /^<\/?[a-zA-Z][\s\S]*>$/.test(trimmed) || /^<br\s*\/?>$/.test(trimmed);
}

/** 自闭合/空标签,不参与 HTML 块深度计数。 */
const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 统计一行内 HTML 标签的净深度(开标签 +1 / 闭标签 -1,void 与自闭合计 0)。 */
function countHtmlDelta(line: string): number {
  let delta = 0;
  const re = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const closing = m[1] === "/";
    const selfClosing = m[3] === "/";
    const tag = m[2].toLowerCase();
    if (selfClosing || VOID_HTML_TAGS.has(tag)) continue;
    delta += closing ? -1 : 1;
  }
  return delta;
}

/** 判断一行是否为表格行。 */
function isTableRow(line: string): boolean {
  return /^\s*\|(.+)\|\s*$/.test(line);
}

/**
 * 将 Markdown 文本解析为 HTML 字符串。
 * 支持标题/段落/列表/引用/代码块/表格/水平线/原生 HTML 块。
 */
export function parseMarkdown(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let paragraph: string[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];
  const lists: Array<{ type: "ul" | "ol"; indent: number; itemOpen: boolean }> = [];
  let inBlockquote = false;
  let blockquoteBuffer: string[] = [];
  /** HTML 容器块嵌套深度:>0 表示位于原生 HTML 块内,行原样透传不解析。 */
  let htmlBlockDepth = 0;

  function flushParagraph() {
    if (paragraph.length) {
      html += `<p>${inlineMarkdown(paragraph.join(" "))}</p>\n`;
      paragraph = [];
    }
  }

  function closeList() {
    const list = lists.pop();
    if (!list) return;
    if (list.itemOpen) html += "</li>\n";
    html += `</${list.type}>\n`;
  }

  function closeLists() {
    while (lists.length) closeList();
  }

  function appendListItem(type: "ul" | "ol", indent: number, content: string) {
    while (lists.length && indent < lists[lists.length - 1].indent) closeList();

    let current = lists[lists.length - 1];
    if (!current || indent > current.indent) {
      if (current && !html.endsWith("\n")) html += "\n";
      html += `<${type}>\n`;
      current = { type, indent, itemOpen: false };
      lists.push(current);
    } else if (current.type !== type) {
      closeList();
      html += `<${type}>\n`;
      current = { type, indent, itemOpen: false };
      lists.push(current);
    }

    if (current.itemOpen) html += "</li>\n";
    html += `<li>${inlineMarkdown(content)}`;
    current.itemOpen = true;
  }

  function flushBlockquote() {
    if (inBlockquote) {
      html += `<blockquote><p>${inlineMarkdown(blockquoteBuffer.join(" "))}</p></blockquote>\n`;
      blockquoteBuffer = [];
      inBlockquote = false;
    }
  }

  function parseTable(startIndex: number): { html: string; nextIndex: number } | null {
    const tableLines: string[] = [];
    let i = startIndex;
    while (i < lines.length && isTableRow(lines[i])) {
      tableLines.push(lines[i]);
      i++;
    }
    if (tableLines.length < 2 || !/^\s*\|?[\s:-]+\|[\s|:-]*$/.test(tableLines[1])) {
      return null;
    }
    const getCells = (row: string) =>
      row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => inlineMarkdown(cell.trim()));

    const headers = getCells(tableLines[0]);
    const bodyRows = tableLines.slice(2).map(getCells);

    let tableHtml = '<div class="compare-table-wrap"><table><thead><tr>';
    headers.forEach((h) => {
      tableHtml += `<th>${h}</th>`;
    });
    tableHtml += "</tr></thead><tbody>";
    bodyRows.forEach((row) => {
      tableHtml += "<tr>";
      row.forEach((cell) => {
        tableHtml += `<td>${cell}</td>`;
      });
      tableHtml += "</tr>";
    });
    tableHtml += "</tbody></table></div>\n";
    return { html: tableHtml, nextIndex: i - 1 };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      closeLists();
      flushBlockquote();
      if (!inCode) {
        inCode = true;
        codeBuffer = [];
      } else {
        html += `<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>\n`;
        inCode = false;
        codeBuffer = [];
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    // 位于 HTML 容器块内:原样透传(含空行/裸文字/<br>/嵌套),不解析 markdown。
    if (htmlBlockDepth > 0) {
      html += line + "\n";
      htmlBlockDepth = Math.max(0, htmlBlockDepth + countHtmlDelta(line));
      continue;
    }

    // 进入 HTML 容器块:整行以 < 开头且本行开标签净增。
    const htmlDelta = countHtmlDelta(line);
    if (htmlDelta > 0 && trimmed.startsWith("<")) {
      flushParagraph();
      closeLists();
      flushBlockquote();
      htmlBlockDepth = htmlDelta;
      html += line + "\n";
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushBlockquote();
      continue;
    }

    if (isHtmlLine(line)) {
      flushParagraph();
      closeLists();
      flushBlockquote();
      html += line + "\n";
      continue;
    }

    if (isTableRow(line)) {
      const table = parseTable(i);
      if (table) {
        flushParagraph();
        closeLists();
        flushBlockquote();
        html += table.html;
        i = table.nextIndex;
        continue;
      }
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushParagraph();
      closeLists();
      flushBlockquote();
      const level = trimmed.match(/^#{1,6}/)![0].length;
      const text = trimmed.replace(/^#{1,6}\s+/, "");
      html += `<h${level}>${inlineMarkdown(text)}</h${level}>\n`;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      closeLists();
      inBlockquote = true;
      blockquoteBuffer.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    const listItem = line.match(/^([ \t]*)([-*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      flushBlockquote();
      const indent = listItem[1].replaceAll("\t", "    ").length;
      appendListItem(listItem[2].endsWith(".") ? "ol" : "ul", indent, listItem[3]);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      closeLists();
      flushBlockquote();
      html += "<hr />\n";
      continue;
    }

    if (lists.length && /^[ \t]+/.test(line)) {
      html += ` ${inlineMarkdown(trimmed)}`;
    } else {
      closeLists();
      paragraph.push(trimmed);
    }
  }

  flushParagraph();
  closeLists();
  flushBlockquote();
  if (inCode) {
    html += `<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>\n`;
  }
  return html;
}
