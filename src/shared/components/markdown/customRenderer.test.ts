import { describe, expect, it } from "vitest";
import { parseMarkdown, separateBareUrlTrailingText, splitStructuredSegments } from "./customRenderer";

describe("parseMarkdown", () => {
  it("只把裸 URL 渲染为链接，不吞掉右括号后的中文正文", () => {
    const input = separateBareUrlTrailingText("（https://openai.com/research/index/release)公开的最新产品为：");

    expect(parseMarkdown(input)).toBe(
      '<p>（<a href="https://openai.com/research/index/release" target="_blank" rel="noopener noreferrer">https://openai.com/research/index/release</a>)<!-- -->公开的最新产品为：</p>\n',
    );
  });

  it("不改写代码块和行内代码中的 URL 边界", () => {
    const input = "`https://example.com/path)正文`\n\n```txt\nhttps://example.com/path)正文\n```";

    expect(separateBareUrlTrailingText(input)).toBe(input);
    expect(parseMarkdown(input)).toContain("<p><code>https://example.com/path)正文</code></p>");
  });

  it("保留显式链接和 URL 内成对括号", () => {
    const input = "[说明](https://example.com/docs)中文 与 https://example.com/wiki/Function_(math)";

    expect(separateBareUrlTrailingText(input)).toBe(input);
    expect(parseMarkdown(input)).toContain(
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">说明</a>中文 与 <a href="https://example.com/wiki/Function_(math)" target="_blank" rel="noopener noreferrer">https://example.com/wiki/Function_(math)</a>',
    );
  });

  it("不改写 HTML 标签属性中的 URL", () => {
    const input = '<a href="https://example.com/path)中文">说明</a>';

    expect(separateBareUrlTrailingText(input)).toBe(input);
  });

  it("转义裸 URL 生成的链接属性", () => {
    expect(parseMarkdown('https://example.com/?q="value"')).toContain(
      '<a href="https://example.com/?q=&quot;value&quot;" target="_blank" rel="noopener noreferrer">https://example.com/?q="value"</a>',
    );
  });

  it("HTML 容器块内的裸文字不被打散为 <p>", () => {
    const input = [
      '<div style="display:flex;">',
      '<div style="flex:1;background:#1a1a1a;color:#fff;padding:18px;">',
      '<div style="font-size:13px;color:#cccccc;">',
      "由 Z.ai 训练的大语言模型。<br>",
      "无实体、无个人记忆。<br>",
      "当前角色：协助调试。",
      "</div>",
      "</div>",
      "</div>",
    ].join("\n");

    const out = parseMarkdown(input);

    expect(out).not.toContain("<p>由 Z.ai");
    expect(out).not.toContain("<p>无实体");
    expect(out).not.toContain("<p>当前角色");
    // 原样保留文字与 <br>
    expect(out).toContain("由 Z.ai 训练的大语言模型。<br>");
    expect(out).toContain("当前角色：协助调试。");
    // 保留外层容器结构
    expect(out).toContain('<div style="display:flex;">');
  });

  it("嵌套 HTML 容器内部文字无 <p> 包裹", () => {
    const input = ["<div>", "<section>", "嵌套文字", "</section>", "</div>"].join("\n");
    const out = parseMarkdown(input);
    expect(out).not.toContain("<p>嵌套文字");
    expect(out).toContain("嵌套文字");
  });

  it("void 标签不扰动块深度", () => {
    const input = ["<div>", "<br>", "<hr>", '<img src="x.png">', "文字行", "</div>"].join("\n");
    const out = parseMarkdown(input);
    expect(out).not.toContain("<p>文字行");
    expect(out).toContain("文字行");
  });

  it("同行开闭标签不进入块模式(走 isHtmlLine 透传)", () => {
    const input = ["<div>同行文字</div>", "", "# 标题"].join("\n");
    const out = parseMarkdown(input);
    // 同行开闭原样输出,后续 markdown 仍正常解析
    expect(out).toContain("<div>同行文字</div>");
    expect(out).toContain("<h1>标题</h1>");
  });

  it("HTML 块结束后恢复 markdown 解析", () => {
    const input = ["<div>", "块内内容", "</div>", "", "# 标题", "", "正文段落"].join("\n");
    const out = parseMarkdown(input);
    expect(out).not.toContain("<p>块内内容");
    expect(out).toContain("块内内容");
    expect(out).toContain("<h1>标题</h1>");
    expect(out).toContain("<p>正文段落</p>");
  });

  it("普通 markdown 回归(标题/列表/引用/代码/表格/水平线)", () => {
    const input = [
      "# 标题",
      "",
      "段落 **加粗** 文本。",
      "",
      "- 项目一",
      "- 项目二",
      "",
      "1. 有序一",
      "",
      "> 引用",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "---",
    ].join("\n");
    const out = parseMarkdown(input);
    expect(out).toContain("<h1>标题</h1>");
    expect(out).toContain("<strong>加粗</strong>");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>项目一</li>");
    expect(out).toContain("<ol>");
    expect(out).toContain("<li>有序一</li>");
    expect(out).toContain("<blockquote>");
    expect(out).toContain("<pre><code>");
    expect(out).toContain("<table>");
    expect(out).toContain("<hr />");
  });

  it("保留嵌套列表层级", () => {
    const input = [
      "- 父项",
      "",
      "  - 子项一",
      "",
      "  - 子项二",
      "",
      "- 另一父项",
    ].join("\n");

    expect(parseMarkdown(input)).toBe([
      "<ul>",
      "<li>父项",
      "<ul>",
      "<li>子项一</li>",
      "<li>子项二</li>",
      "</ul>",
      "</li>",
      "<li>另一父项</li>",
      "</ul>",
      "",
    ].join("\n"));
  });

  it("支持有序与无序列表混合嵌套", () => {
    const input = [
      "1. 父项",
      "   - 子项",
      "2. 另一父项",
    ].join("\n");

    expect(parseMarkdown(input)).toContain("<li>父项\n<ul>\n<li>子项</li>\n</ul>\n</li>");
  });

  it("多级列表退级时逐层闭合", () => {
    const input = [
      "- 父项",
      "  1. 子项",
      "    - 孙项",
      "  2. 另一子项",
      "- 另一父项",
    ].join("\n");

    expect(parseMarkdown(input)).toBe([
      "<ul>",
      "<li>父项",
      "<ol>",
      "<li>子项",
      "<ul>",
      "<li>孙项</li>",
      "</ul>",
      "</li>",
      "<li>另一子项</li>",
      "</ol>",
      "</li>",
      "<li>另一父项</li>",
      "</ul>",
      "",
    ].join("\n"));
  });
});

describe("splitStructuredSegments", () => {
  it("纯 markdown(无结构化块)归为单个 markdown 段", () => {
    const segs = splitStructuredSegments("# 标题\n正文");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ type: "markdown", text: "# 标题\n正文" });
  });

  it("chart 代码块切为 structured 段,正文原样保留", () => {
    const input = '```chart\n{"type":"bar","series":[{"key":"a"}],"data":[]}\n```';
    const segs = splitStructuredSegments(input);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("structured");
    if (segs[0].type === "structured") {
      expect(segs[0].kind).toBe("chart");
      expect(segs[0].raw).toContain('"type":"bar"');
    }
  });

  it("markdown / metric / markdown 三段切分", () => {
    const input = "前文\n```metric\n{}\n```\n后文";
    const segs = splitStructuredSegments(input);
    expect(segs).toHaveLength(3);
    expect(segs[0].type).toBe("markdown");
    expect(segs[1].type).toBe("structured");
    expect(segs[2].type).toBe("markdown");
  });

  it("非结构化代码块(如 js)单独切为 code 段(交 Streamdown 高亮渲染)", () => {
    const input = "```js\nconst x = 1;\n```";
    const segs = splitStructuredSegments(input);
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("code");
    if (segs[0].type === "code") {
      expect(segs[0].language).toBe("js");
      expect(segs[0].raw).toContain("const x = 1;");
    }
  });

  it("连续多个结构化块各自成段", () => {
    const input = "```chart\n{}\n```\n```table\n{}\n```";
    const segs = splitStructuredSegments(input);
    expect(segs.filter((s) => s.type === "structured")).toHaveLength(2);
  });

  it("仅一个结构化块时,两侧空 markdown 段被过滤", () => {
    const segs = splitStructuredSegments("```chart\n{}\n```");
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("structured");
  });
});
