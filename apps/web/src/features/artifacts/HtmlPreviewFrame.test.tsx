import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";
import { buildHtmlPreviewDoc, HTML_PREVIEW_SANDBOX } from "./html-preview";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("HtmlPreviewFrame", () => {
  it("使用 opaque-origin sandbox 渲染预览", () => {
    const srcDoc = buildHtmlPreviewDoc("<svg><script>window.preview = true</script></svg>");
    const html = renderToStaticMarkup(
      <HtmlPreviewFrame html={'<script>parent.document.body.dataset.pwned = "1"</script>'} />,
    );

    expect(HTML_PREVIEW_SANDBOX).toBe("allow-scripts");
    expect(srcDoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcDoc).toContain("connect-src 'none'");
    expect(srcDoc).toContain("frame-src 'none'");
    expect(html).toContain("<iframe");
    expect(html).toContain('title="preview"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("不再提供脱离 sandbox 的顶层打开入口", () => {
    const inlineHtml = renderToStaticMarkup(<HtmlPreviewFrame html="<p>inline</p>" />);
    const titledHtml = renderToStaticMarkup(
      <HtmlPreviewFrame html="<p>panel</p>" title="Preview" onOpenPanel={() => {}} />,
    );

    expect(inlineHtml).not.toContain("openExternal");
    expect(titledHtml).not.toContain("openExternal");
    expect(titledHtml).toContain("openPanel");
  });
});
