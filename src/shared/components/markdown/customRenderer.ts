/**
 * 自定义 Markdown 渲染器 —— 用于「输出样式」选 custom 渲染器时的静态渲染。
 *
 * 流式期间仍用 streamdown(支持增量解析),流式结束后切换到本渲染器以应用完整的
 * 自定义 CSS(含 class 选择器,如 .takeaway/.card 等高级组件)。原样保留 AI 输出的
 * HTML/class/style,不做过滤(信任 AI 输出,由调用方保证会话可信)。
 */

/** HTML 转义(代码块内容用)。 */
function escapeHtml(str: string): string {
  return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** 行内 Markdown:加粗/斜体/行内代码/链接。 */
function inlineMarkdown(str: string): string {
  return str
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/** 判断一行是否为 HTML 块(整行是单个标签开闭)。 */
function isHtmlLine(line: string): boolean {
  const trimmed = line.trim();
  return /^<\/?[a-zA-Z][\s\S]*>$/.test(trimmed) || /^<br\s*\/?>$/.test(trimmed);
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
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;
  let blockquoteBuffer: string[] = [];

  function flushParagraph() {
    if (paragraph.length) {
      html += `<p>${inlineMarkdown(paragraph.join(" "))}</p>\n`;
      paragraph = [];
    }
  }

  function closeLists() {
    if (inUl) {
      html += "</ul>\n";
      inUl = false;
    }
    if (inOl) {
      html += "</ol>\n";
      inOl = false;
    }
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
    if (!trimmed) {
      flushParagraph();
      closeLists();
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

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      flushBlockquote();
      if (!inUl) {
        closeLists();
        html += "<ul>\n";
        inUl = true;
      }
      html += `<li>${inlineMarkdown(trimmed.replace(/^[-*]\s+/, ""))}</li>\n`;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      flushBlockquote();
      if (!inOl) {
        closeLists();
        html += "<ol>\n";
        inOl = true;
      }
      html += `<li>${inlineMarkdown(trimmed.replace(/^\d+\.\s+/, ""))}</li>\n`;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      closeLists();
      flushBlockquote();
      html += "<hr />\n";
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeLists();
  flushBlockquote();
  if (inCode) {
    html += `<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>\n`;
  }
  return html;
}
