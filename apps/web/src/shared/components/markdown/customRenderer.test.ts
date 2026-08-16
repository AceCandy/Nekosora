import { describe, expect, it } from "vitest";
import {
  collectBareHttpUrls,
  isDirectImageUrl,
  normalizeBareImageUrls,
  normalizeHtmlBlockBlankLines,
  normalizeThematicBreakSpacing,
  parseMarkdown,
  separateBareUrlTrailingText,
  splitStructuredSegments,
  stripPseudoToolCallBlocks,
} from "./customRenderer";

describe("stripPseudoToolCallBlocks", () => {
  it("隐藏完整伪工具调用并保留前后正文", () => {
    expect(stripPseudoToolCallBlocks([
      "前文",
      "<tool_call><function=web_search>{\"query\":\"test\"}</function></tool_call>",
      "后文",
    ].join("\n"))).toBe("前文\n\n后文");
  });

  it("流式期间隐藏尚未闭合的伪工具调用", () => {
    expect(stripPseudoToolCallBlocks("前文\n<tool_call><function=web_search>"))
      .toBe("前文\n");
  });

  it("保留围栏代码和行内代码中的协议示例", () => {
    const input = [
      "`<tool_call>inline</tool_call>`",
      "```xml",
      "<tool_call><function=web_search /></tool_call>",
      "```",
    ].join("\n");

    expect(stripPseudoToolCallBlocks(input)).toBe(input);
  });
});

describe("normalizeHtmlBlockBlankLines", () => {
  it("用不可见注释保留 HTML 容器内的空行", () => {
    expect(normalizeHtmlBlockBlankLines([
      '<div style="display:grid">',
      "  <div>第一项</div>",
      "",
      "    <div>第二项</div>",
      "  ",
      "</div>",
    ].join("\n"))).toBe([
      '<div style="display:grid">',
      "  <div>第一项</div>",
      "<!-- -->",
      "    <div>第二项</div>",
      "  <!-- -->",
      "</div>",
    ].join("\n"));
  });

  it("不改写普通 Markdown 和代码围栏中的空行", () => {
    const input = [
      "正文",
      "",
      "```html",
      "<div>",
      "",
      "</div>",
      "```",
      "",
      "结尾",
    ].join("\n");

    expect(normalizeHtmlBlockBlankLines(input)).toBe(input);
  });

  it("忽略 HTML 注释和属性字符串里的伪标签", () => {
    const input = [
      '<div title="<div>">',
      "<!-- <div> -->",
      "",
      "</div>",
      "",
      "正文",
    ].join("\n");

    expect(normalizeHtmlBlockBlankLines(input)).toBe([
      '<div title="<div>">',
      "<!-- <div> -->",
      "<!-- -->",
      "</div>",
      "",
      "正文",
    ].join("\n"));
  });

  it("多行 HTML 注释不会污染后续容器深度", () => {
    expect(normalizeHtmlBlockBlankLines([
      "<div>",
      "<!--",
      "<div>",
      "",
      "</div>",
      "-->",
      "</div>",
      "",
      "正文",
    ].join("\n"))).toBe([
      "<div>",
      "<!--",
      "<div>",
      ".",
      "</div>",
      "-->",
      "</div>",
      "",
      "正文",
    ].join("\n"));
  });
});

describe("parseMarkdown", () => {
  describe("图片裸 URL", () => {
    it.each([
      ["https://example.com/image.png", true],
      ["https://example.com/image.webp?size=large#preview", true],
      ["https://example.com/image.webp?next=(large)", true],
      ["http://example.com/image.JPEG", true],
      ["https://example.com/image.svg", false],
      ["https://example.com/image.png/extra", false],
      ["//example.com/image.png", false],
    ])("识别 %s -> %s", (url, expected) => {
      expect(isDirectImageUrl(url)).toBe(expected);
    });

    it("转换正文和列表中的图片裸 URL，并保护代码、HTML 与显式链接", () => {
      const input = [
        "正文 https://example.com/image.png",
        "https://example.com/image.png?size=large",
        "```text",
        "https://example.com/code.png",
        "```",
        "    https://example.com/indented.png",
        "<div>",
        "https://example.com/html.png",
        "</div>",
        "- https://example.com/list.png",
        "<span>https://example.com/inline.png</span>",
        "~~~text",
        "https://example.com/tilde.png",
        "~~~",
        "[链接](https://example.com/image.png)",
      ].join("\n");

      expect(normalizeBareImageUrls(input)).toBe([
        "正文 ![图片](<https://example.com/image.png>)",
        "![图片](<https://example.com/image.png?size=large>)",
        "```text",
        "https://example.com/code.png",
        "```",
        "    https://example.com/indented.png",
        "<div>",
        "https://example.com/html.png",
        "</div>",
        "- ![图片](<https://example.com/list.png>)",
        "<span>https://example.com/inline.png</span>",
        "~~~text",
        "https://example.com/tilde.png",
        "~~~",
        "[链接](https://example.com/image.png)",
      ].join("\n"));
    });

    it("用尖括号 destination 保留 URL 参数中的括号", () => {
      expect(normalizeBareImageUrls("https://example.com/image.png?next=(large)"))
        .toBe("![图片](<https://example.com/image.png?next=(large)>)");
    });

    it("用服务端 MIME 探测结果提升无扩展名图片", () => {
      const url = "https://cdn.example.com/asset?id=42";
      expect(normalizeBareImageUrls(`图片 ${url}`, new Set([url])))
        .toBe(`图片 ![图片](<${url}>)`);
      expect(normalizeBareImageUrls(`图片 ${url}`)).toBe(`图片 ${url}`);
    });

    it("只收集可提升的裸 URL", () => {
      expect(collectBareHttpUrls([
        "正文 https://cdn.example.com/asset?id=42",
        "- https://example.com/list.png",
        "`https://example.com/inline.png`",
        "[链接](https://example.com/linked.png)",
        "<span>https://example.com/html.png</span>",
        "```text",
        "https://example.com/code.png",
        "```",
      ].join("\n"))).toEqual([
        "https://cdn.example.com/asset?id=42",
        "https://example.com/list.png",
      ]);
    });

    it("不会被较短的围栏误结束", () => {
      const input = [
        "````text",
        "https://example.com/code.png",
        "```",
        "https://example.com/code-too.png",
        "````",
      ].join("\n");

      expect(normalizeBareImageUrls(input)).toBe(input);
    });
  });

  it("给章节标题前的分隔线补空行，避免上一段被解析为 Setext 标题", () => {
    const input = "#### 辅助 On\n正文内容。\n---\n### 【TES 亚军阵容】";

    expect(normalizeThematicBreakSpacing(input)).toBe(
      "#### 辅助 On\n正文内容。\n\n---\n### 【TES 亚军阵容】",
    );
  });

  it("给普通后续段落前的分隔线补空行", () => {
    const input = "#### 辅助 Meiko\n老将的遗憾吧。\n---\n整个系列赛都很精彩。";

    expect(normalizeThematicBreakSpacing(input)).toBe(
      "#### 辅助 Meiko\n老将的遗憾吧。\n\n---\n整个系列赛都很精彩。",
    );
  });

  it("保留明确使用的 Setext 二级标题", () => {
    const input = "标题\n---\n### 子标题";

    expect(normalizeThematicBreakSpacing(input)).toBe(input);
  });

  it("不改写代码块内的分隔线文本", () => {
    const input = "```md\n正文内容\n---\n### 标题\n```";

    expect(normalizeThematicBreakSpacing(input)).toBe(input);
  });

  it("只把裸 URL 渲染为链接，不吞掉右括号后的中文正文", () => {
    const input = separateBareUrlTrailingText("（https://openai.com/research/index/release)公开的最新产品为：");

    expect(input).toBe("（https://openai.com/research/index/release<!-- -->)公开的最新产品为：");
    expect(parseMarkdown(input)).toBe(
      '<p>（<a href="https://openai.com/research/index/release" data-preview-url="https://openai.com/research/index/release" data-safety-url="https://openai.com/research/index/release" target="_blank" rel="noopener noreferrer">https://openai.com/research/index/release</a><!-- -->)公开的最新产品为：</p>\n',
    );
  });

  it.each([
    ["https://openai.com/research/index/release公开的最新产品为：", "https://openai.com/research/index/release<!-- -->公开的最新产品为："],
    ["https://openai.com/research/index/release）公开的最新产品为：", "https://openai.com/research/index/release<!-- -->）公开的最新产品为："],
    ["https://openai.com/research/index/release）", "https://openai.com/research/index/release<!-- -->）"],
  ])("分离裸 URL 后的正文和外层括号：%s", (input, expected) => {
    expect(separateBareUrlTrailingText(input)).toBe(expected);
  });

  it("不改写代码块和行内代码中的 URL 边界", () => {
    const input = "`https://example.com/path)正文`\n\n```txt\nhttps://example.com/path)正文\n```";

    expect(separateBareUrlTrailingText(input)).toBe(input);
    expect(parseMarkdown(input)).toContain("<p><code>https://example.com/path)正文</code></p>");
  });

  it("保留显式链接和 URL 内成对括号", () => {
    const input = "[说明](https://example.com/docs)中文 与 https://example.com/wiki/Function_(math)正文";
    const normalized = separateBareUrlTrailingText(input);

    expect(normalized).toBe(
      "[说明](https://example.com/docs)中文 与 https://example.com/wiki/Function_(math)<!-- -->正文",
    );
    expect(parseMarkdown(normalized)).toContain(
      '<a href="https://example.com/docs" data-preview-url="https://example.com/docs" data-safety-url="https://example.com/docs" target="_blank" rel="noopener noreferrer">说明</a>中文 与 <a href="https://example.com/wiki/Function_(math)" data-preview-url="https://example.com/wiki/Function_(math)" data-safety-url="https://example.com/wiki/Function_(math)" target="_blank" rel="noopener noreferrer">https://example.com/wiki/Function_(math)</a><!-- -->正文',
    );
  });

  it("不改写 HTML 标签属性中的 URL", () => {
    const input = '<a href="https://example.com/path)中文">说明</a>';

    expect(separateBareUrlTrailingText(input)).toBe(input);
  });

  it("转义裸 URL 生成的链接属性", () => {
    expect(parseMarkdown('https://example.com/?q="value"')).toContain(
      '<a href="https://example.com/?q=&quot;value&quot;" data-preview-url="https://example.com/?q=&quot;value&quot;" data-safety-url="https://example.com/?q=&quot;value&quot;" target="_blank" rel="noopener noreferrer">https://example.com/?q="value"</a>',
    );
  });

  it("拒绝危险协议并保留 HTTP(S) 与站内相对链接", () => {
    const out = parseMarkdown([
      "[外链](https://example.com/docs)",
      "[站内](/chat/example)",
      "[脚本](javascript:alert%281%29)",
      "[数据](data:text/html;base64,PHNjcmlwdD4=)",
      "[实体](&#106;avascript:alert%281%29)",
      "[十六进制实体](&#x6a;avascript:alert%281%29)",
      "![脚本图片](javascript:alert%281%29)",
      "![数据图片](data:image/png;base64,AAAA)",
    ].join("\n\n"));

    expect(out).toContain('<a href="https://example.com/docs"');
    expect(out).toContain('<a href="/chat/example"');
    expect(out).toContain("<p>脚本</p>");
    expect(out).toContain("<p>数据</p>");
    expect(out).toContain("<p>实体</p>");
    expect(out).toContain("<p>十六进制实体</p>");
    expect(out).toContain("<p>脚本图片</p>");
    expect(out).toContain("<p>数据图片</p>");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:text/html");
    expect(out).not.toContain("data:image/png");
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

  it("列表中的图片保持在同一个有序列表内", () => {
    const out = parseMarkdown([
      "1. 第一项",
      "2. 第二项",
      "3. 第三项",
      "4. ![图片](<https://example.com/photo.png>)",
      "5. 第五项",
    ].join("\n"));

    expect(out.match(/<ol>/g)).toHaveLength(1);
    expect(out.match(/<li>/g)).toHaveLength(5);
    expect(out).toContain('<img src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Fphoto.png" alt="图片"');
    expect(out).toContain('data-markdown-image-url="https://example.com/photo.png"');
    expect(out).toContain('role="button" tabindex="0"');
    expect(out).toContain("<li>第五项</li>");
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
