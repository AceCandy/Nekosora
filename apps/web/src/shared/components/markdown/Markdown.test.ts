import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKDOWN_CONTROLS, shouldCollapseCodeBlock } from "./markdownControls";

const mocks = vi.hoisted(() => ({
  createPortal: vi.fn((node: unknown) => node),
}));

vi.mock("react-dom", () => ({ createPortal: mocks.createPortal }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/shared/components/mermaid/MermaidDiagram", async () => {
  const React = await import("react");
  return {
    MermaidDiagram: ({ className, preserveContentScale }: { className?: string; preserveContentScale?: boolean }) => React.createElement("div", {
      className,
      "data-testid": "mermaid-diagram",
      "data-preserve-content-scale": preserveContentScale ? "true" : undefined,
    }),
  };
});

import { Markdown, MarkdownLinkSafetyModal, requestLinkPreview } from "./Markdown";
import { MarkdownImagePreviewModal } from "./MarkdownImage";

const originalDocument = globalThis.document;

afterEach(() => {
  mocks.createPortal.mockClear();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("Markdown", () => {
  it("禁用 Streamdown 原生代码块 actions,由 Nekosora 自定义紧凑按钮接管", () => {
    expect(MARKDOWN_CONTROLS).toMatchObject({
      table: false,
      code: false,
    });
  });

  it("把链接安全确认层 Portal 到 body，避免块元素进入 Markdown 段落", () => {
    const body = {};
    Object.defineProperty(globalThis, "document", { configurable: true, value: { body } });

    const html = renderToStaticMarkup(createElement(MarkdownLinkSafetyModal, {
      isOpen: true,
      onClose: () => {},
      onConfirm: () => {},
      url: "https://example.com",
    }));

    expect(mocks.createPortal).toHaveBeenCalledWith(expect.anything(), body);
    expect(html).toContain("<dialog");
    expect(html).toContain("https://example.com");
  });

  it("流式期间保持长代码展开,结束后才允许折叠", () => {
    expect(shouldCollapseCodeBlock(17, true)).toBe(false);
    expect(shouldCollapseCodeBlock(17, false)).toBe(true);
    expect(shouldCollapseCodeBlock(16, false)).toBe(false);
  });

  it("custom 渲染器给外链附加统一预览标记", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "[示例](https://example.com/docs)",
      renderer: "custom",
    }));

    expect(html).toContain('data-preview-url="https://example.com/docs"');
  });

  it("默认渲染器给外链附加统一预览和安全标记", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "[示例](https://example.com/docs)",
    }));

    expect(html).toContain('data-preview-url="https://example.com/docs"');
    expect(html).toContain('data-safety-url="https://example.com/docs"');
  });

  it("默认渲染器持续解析 HTML 容器内空行后的嵌套标签", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: [
        '<div style="display:grid">',
        '  <div style="font-weight:600">第一项</div>',
        "",
        '    <div style="color:#555">第二项</div>',
        "</div>",
      ].join("\n"),
      isStreaming: true,
    }));

    expect(html).toContain('style="font-weight:600"');
    expect(html).toContain('style="color:#555"');
    expect(html).not.toContain('data-streamdown="code-block"');
    expect(html).not.toContain("&lt;div");
  });

  it("custom 渲染器把独占行图片裸 URL 交给 MarkdownImage", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "https://example.com/photo.webp?size=large",
      renderer: "custom",
    }));

    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Fphoto.webp%3Fsize%3Dlarge"');
    expect(html).toContain('alt="图片"');
    expect(html).not.toContain("<figure");
  });

  it("custom 渲染器在普通正文中也保留独占行图片组件", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "前文\n\nhttps://example.com/photo.webp\n\n后文",
      renderer: "custom",
    }));

    expect(html).toContain("前文");
    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Fphoto.webp"');
    expect(html).toContain("后文");
  });

  it("custom 渲染器展示正文和列表中的图片裸 URL", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "正文 https://example.com/inline.png 后文\n\n- https://example.com/list.jpg",
      renderer: "custom",
    }));

    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Finline.png"');
    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Flist.jpg"');
    expect(html).toContain('data-markdown-image-url="https://example.com/inline.png"');
    expect(html).toContain('data-markdown-image-url="https://example.com/list.jpg"');
    expect(html).toContain('tabindex="0"');
  });

  it("图片预览弹窗提供复制原始链接操作", () => {
    const body = {};
    Object.defineProperty(globalThis, "document", { configurable: true, value: { body } });

    const html = renderToStaticMarkup(createElement(MarkdownImagePreviewModal, {
      open: true,
      onClose: () => {},
      src: "https://example.com/original.png?token=public",
      alt: "示例图片",
    }));

    expect(mocks.createPortal).toHaveBeenCalledWith(expect.anything(), body);
    expect(html).toContain('aria-label="imageCopyLink"');
    expect(html).toContain('aria-label="imageDownload"');
    expect(html).toContain("border-0 bg-transparent");
    expect(html).toContain("backdrop:bg-black/75");
    expect(html).toContain("max-h-[92dvh]");
    expect(html).not.toContain("<header");
    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Foriginal.png%3Ftoken%3Dpublic"');
  });

  it("custom 渲染器展示显式 Markdown 图片", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "![封面](https://example.com/cover.png)",
      renderer: "custom",
    }));

    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Fcover.png"');
    expect(html).toContain('alt="封面"');
  });

  it("默认渲染器把带括号参数的图片裸 URL 交给 MarkdownImage", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "https://example.com/photo.webp?next=(large)",
    }));

    expect(html).toContain('src="/api/link-preview?mode=image&amp;url=https%3A%2F%2Fexample.com%2Fphoto.webp%3Fnext%3D%28large%29"');
    expect(html).toContain('alt="图片"');
  });

  it("外链元数据请求失败后允许再次尝试", async () => {
    const preview = {
      url: "https://retry.example.com/",
      kind: "html" as const,
      contentType: "text/html",
      title: "Retry success",
      description: "Loaded on the second request",
      siteName: null,
      imageUrl: null,
      iconUrl: null,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json(preview));

    await expect(requestLinkPreview("metadata", "https://retry.example.com")).resolves.toBeNull();
    await expect(requestLinkPreview("metadata", "https://retry.example.com")).resolves.toEqual(preview);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("正文 Mermaid SVG 使用完整可用宽度", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: "```mermaid\ngraph TD\nA --> B\n```",
    }));

    expect(html).toContain('data-testid="mermaid-diagram"');
    expect(html).toContain("[&amp;_svg]:!w-full");
    expect(html).toContain('data-preserve-content-scale="true"');
    expect(html).not.toContain("[&amp;_svg]:w-auto");
  });
});
