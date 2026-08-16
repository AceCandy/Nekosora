/**
 * 自定义 Markdown 渲染器 —— 用于「输出样式」选 custom 渲染器时的静态渲染。
 *
 * 流式期间仍用 streamdown(支持增量解析),流式结束后切换到本渲染器以应用完整的
 * 自定义 CSS(含 class 选择器,如 .takeaway/.card 等高级组件)。原样保留 AI 输出的
 * HTML/class/style,不做过滤,不属于 XSS 净化边界;仅由管理员在模型与内容来源可控时启用。
 */

import { resolveStructuredKind } from "@/lib/artifacts/structured";
import { resolvePreviewableKind } from "@/lib/artifacts/previewable";
import type { StructuredKind } from "@/shared/components/structured-blocks/schema";
import { getProxiedMarkdownImageUrl } from "./linkPreview";

/** 混合渲染分段:结构化块(chart/metric/table)、mermaid 图、普通代码块与 markdown 文本分别处理。 */
export type StructuredSegment =
  | { type: "structured"; kind: StructuredKind; raw: string }
  | { type: "mermaid"; raw: string }
  | { type: "code"; language: string; raw: string }
  | { type: "markdown"; text: string };

/** 隐藏模型作为普通正文输出的伪工具调用协议，不将其误当成可执行工具。 */
export function stripPseudoToolCallBlocks(input: string): string {
  const output: string[] = [];
  let markdown: string[] = [];
  let fence: { char: string; length: number } | null = null;

  const flushMarkdown = () => {
    if (markdown.length === 0) return;
    const codeSpans: string[] = [];
    const protectedText = markdown.join("\n").replace(/(`+)([^\n]*?)\1/g, (value) => {
      const index = codeSpans.push(value) - 1;
      return `\u0000CODE${index}\u0000`;
    });
    output.push(
      protectedText
        .replace(/<tool_call\b[^>]*>[\s\S]*?(?:<\/tool_call\s*>|$)/gi, "")
        .replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => codeSpans[Number(index)] ?? ""),
    );
    markdown = [];
  };

  for (const line of input.split("\n")) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      output.push(line);
      if (match?.[1][0] === fence.char
        && match[1].length >= fence.length
        && line.slice(match[0].length).trim() === "") fence = null;
    } else if (match) {
      flushMarkdown();
      output.push(line);
      fence = { char: match[1][0], length: match[1].length };
    } else {
      markdown.push(line);
    }
  }
  flushMarkdown();
  return output.join("\n");
}

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

/** 仅允许 HTTP(S) 绝对地址；链接可额外保留同源相对地址。 */
function getSafeMarkdownUrl(value: string, allowRelative = false): string | null {
  const href = value.trim();
  if (!href) return null;
  if (allowRelative && href.startsWith("&")) return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? href : null;
  } catch {
    if (!allowRelative) return null;
  }
  try {
    const base = "https://markdown.local";
    return new URL(href, base).origin === base ? href : null;
  } catch {
    return null;
  }
}

/** 阻止 GFM 裸链接把紧跟的中文正文误识别为 URL。 */
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
          ? part
            .replace(/(https?:\/\/[^\s<）]+)）/g, "$1<!-- -->）")
            .replace(
              /(https?:\/\/[^\s<\u3400-\u9fff]+)(?=[\u3400-\u9fff])/g,
              (_, value: string) => {
                let href = value;
                let trailing = "";
                while (href.endsWith(")") && href.split(")").length > href.split("(").length) {
                  href = href.slice(0, -1);
                  trailing = `)${trailing}`;
                }
                return `${href}<!-- -->${trailing}`;
              },
            )
          : part)
        .join("");
    })
    .join("\n");
}

const DIRECT_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif)$/i;
const INLINE_PROTECTED_RE = /(`+[^`]*`+|!?\[[^\]]*\]\((?:<[^>]*>|(?:[^()]|\([^()]*\))*)\)|<[^>]*>)/g;
const BARE_HTTP_URL_RE = /https?:\/\/[^\s<]+/g;

/** 判断 URL 是否为可直接加载的远程图片地址。 */
export function isDirectImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && DIRECT_IMAGE_EXT_RE.test(url.pathname);
  } catch {
    return false;
  }
}

function trimBareUrl(value: string): { href: string; trailing: string } {
  let href = value.replace(/[.,;:!?，。；：！？]+$/, "");
  while (href.endsWith(")") && href.split(")").length > href.split("(").length) {
    href = href.slice(0, -1);
  }
  while (href.endsWith("）")) href = href.slice(0, -1);
  return { href, trailing: value.slice(href.length) };
}

function transformBareHttpUrls(
  input: string,
  transform: (url: string) => string,
): string {
  let fence: { char: "`" | "~"; length: number } | null = null;
  let htmlBlockDepth = 0;

  return input.split("\n").map((line) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const nextChar = fenceMatch[1][0] as "`" | "~";
      if (!fence) {
        fence = { char: nextChar, length: fenceMatch[1].length };
      } else if (fence.char === nextChar && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        fence = null;
      }
      return line;
    }
    if (fence) return line;
    if (htmlBlockDepth > 0) {
      htmlBlockDepth = Math.max(0, htmlBlockDepth + countHtmlDelta(line));
      return line;
    }
    if (isHtmlLine(line)) {
      htmlBlockDepth = Math.max(0, countHtmlDelta(line));
      return line;
    }
    if (/^(?: {4}|\t)/.test(line)) return line;

    let cursor = 0;
    let output = "";
    for (const protectedMatch of line.matchAll(INLINE_PROTECTED_RE)) {
      const index = protectedMatch.index ?? 0;
      output += line.slice(cursor, index).replace(BARE_HTTP_URL_RE, (value) => {
        const { href, trailing } = trimBareUrl(value);
        return `${transform(href)}${trailing}`;
      });
      output += protectedMatch[0];
      cursor = index + protectedMatch[0].length;
    }
    output += line.slice(cursor).replace(BARE_HTTP_URL_RE, (value) => {
      const { href, trailing } = trimBareUrl(value);
      return `${transform(href)}${trailing}`;
    });
    return output;
  }).join("\n");
}

/** 收集代码、HTML 与显式 Markdown 链接之外的 HTTP(S) 裸 URL。 */
export function collectBareHttpUrls(input: string): string[] {
  const urls = new Set<string>();
  transformBareHttpUrls(input, (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") urls.add(url);
    } catch {
      // 无效 URL 保持普通文本。
    }
    return url;
  });
  return [...urls];
}

/** 将已确认的图片裸 URL 转为标准 Markdown 图片语法。 */
export function normalizeBareImageUrls(
  input: string,
  confirmedImageUrls: ReadonlySet<string> = new Set(),
): string {
  return transformBareHttpUrls(input, (url) => (
    isDirectImageUrl(url) || confirmedImageUrls.has(url)
      ? `![图片](<${url}>)`
      : url
  ));
}

/** 避免章节分隔线被 CommonMark 解释为上一段的 Setext 二级标题。 */
export function normalizeThematicBreakSpacing(input: string): string {
  const lines = input.split("\n");
  const normalized: string[] = [];
  let inCodeBlock = false;

  lines.forEach((line, index) => {
    const previousLine = lines[index - 1]?.trim() ?? "";
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }
    if (
      !inCodeBlock
      && line.trim() === "---"
      && /[。！？.!?][”’"'）)]?$/.test(previousLine)
    ) {
      normalized.push("");
    }
    normalized.push(line);
  });

  return normalized.join("\n");
}

/** 行内 Markdown:加粗/斜体/行内代码/链接。 */
function inlineMarkdown(str: string): string {
  const markdownImageRe = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\)\s]+))\)/g;
  const protectedFragments: string[] = [];
  const protect = (html: string) => {
    const index = protectedFragments.push(html) - 1;
    return `\u0000FRAGMENT${index}\u0000`;
  };
  const withProtectedFragments = str
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, (_, code: string) => protect(`<code>${code}</code>`))
    .replace(markdownImageRe, (_, alt: string, angleSrc: string | undefined, plainSrc: string | undefined) => {
      const src = angleSrc ?? plainSrc ?? "";
      const safeSrc = getSafeMarkdownUrl(src);
      if (!safeSrc) return protect(escapeHtml(alt));
      const escapedSrc = escapeHtmlAttribute(safeSrc);
      return protect(
        `<img src="${escapeHtmlAttribute(getProxiedMarkdownImageUrl(safeSrc))}" alt="${escapeHtmlAttribute(alt)}" data-markdown-image-url="${escapedSrc}" role="button" tabindex="0" loading="lazy" decoding="async" class="my-2 block max-w-full cursor-zoom-in rounded-lg border border-morning-mist outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:border-deep-space/80" />`,
      );
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
      const safeHref = getSafeMarkdownUrl(href, true);
      if (!safeHref) return protect(escapeHtml(label));
      const escapedHref = escapeHtmlAttribute(safeHref);
      return protect(`<a href="${escapedHref}" data-preview-url="${escapedHref}" data-safety-url="${escapedHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    });

  return withProtectedFragments
    .replace(/https?:\/\/[^\s<]+/g, (value) => {
      const { href, trailing } = trimBareUrl(value);
      return `<a href="${escapeHtmlAttribute(href)}" data-preview-url="${escapeHtmlAttribute(href)}" data-safety-url="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href)}</a>${trailing}`;
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
const RAW_TEXT_HTML_TAGS = new Set(["script", "style", "textarea", "title"]);

interface HtmlScanState {
  inComment: boolean;
  rawTextTag: string | null;
}

/** 统计一行内 HTML 标签的净深度(开标签 +1 / 闭标签 -1,void 与自闭合计 0)。 */
function countHtmlDelta(line: string, state?: HtmlScanState): number {
  const scanState = state ?? { inComment: false, rawTextTag: null };
  let delta = 0;
  let cursor = 0;
  const lowerLine = line.toLowerCase();

  while (cursor < line.length) {
    if (scanState.inComment) {
      const commentEnd = line.indexOf("-->", cursor);
      if (commentEnd < 0) break;
      scanState.inComment = false;
      cursor = commentEnd + 3;
      continue;
    }
    if (scanState.rawTextTag) {
      const closingStart = lowerLine.indexOf(`</${scanState.rawTextTag}`, cursor);
      if (closingStart < 0) break;
      cursor = closingStart;
    }

    const tagStart = line.indexOf("<", cursor);
    if (tagStart < 0) break;
    if (line.startsWith("<!--", tagStart)) {
      scanState.inComment = true;
      cursor = tagStart + 4;
      continue;
    }

    let tagCursor = tagStart + 1;
    const closing = line[tagCursor] === "/";
    if (closing) tagCursor++;
    const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(line.slice(tagCursor));
    if (!tagMatch) {
      cursor = tagStart + 1;
      continue;
    }
    const tag = tagMatch[0].toLowerCase();
    tagCursor += tagMatch[0].length;

    let quote: "\"" | "'" | null = null;
    while (tagCursor < line.length) {
      const char = line[tagCursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === "\"" || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      tagCursor++;
    }
    if (tagCursor >= line.length) break;

    const selfClosing = line.slice(tagStart, tagCursor).trimEnd().endsWith("/");
    cursor = tagCursor + 1;
    if (selfClosing || VOID_HTML_TAGS.has(tag)) continue;
    delta += closing ? -1 : 1;
    if (closing && scanState.rawTextTag === tag) scanState.rawTextTag = null;
    if (!closing && RAW_TEXT_HTML_TAGS.has(tag)) scanState.rawTextTag = tag;
  }
  return delta;
}

const STREAMDOWN_HTML_CONTAINER_RE = /^\s*<(?:div|section|article|aside|main|details)\b/i;

/**
 * 用不可见注释占住 HTML 容器内的空行，避免 CommonMark 提前结束 raw HTML block。
 * 代码围栏保持原样；注释在浏览器中不可见，也不会改变容器内的换行语义。
 */
export function normalizeHtmlBlockBlankLines(input: string): string {
  let htmlBlockDepth = 0;
  let fence: { char: "`" | "~"; length: number } | null = null;
  const htmlScanState: HtmlScanState = { inComment: false, rawTextTag: null };

  return input.split("\n").map((line) => {
    if (htmlBlockDepth > 0) {
      if (!line.trim()) {
        if (htmlScanState.inComment) return `${line}.`;
        if (htmlScanState.rawTextTag) return line;
        return `${line}<!-- -->`;
      }
      htmlBlockDepth = Math.max(0, htmlBlockDepth + countHtmlDelta(line, htmlScanState));
      return line;
    }

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const nextChar = fenceMatch[1][0] as "`" | "~";
      if (!fence) {
        fence = { char: nextChar, length: fenceMatch[1].length };
      } else if (fence.char === nextChar && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        fence = null;
      }
      return line;
    }
    if (fence) return line;

    if (STREAMDOWN_HTML_CONTAINER_RE.test(line)) {
      htmlBlockDepth = Math.max(0, countHtmlDelta(line, htmlScanState));
    }
    return line;
  }).join("\n");
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
