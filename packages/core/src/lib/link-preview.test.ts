import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestPublicResponse: vi.fn() }));

vi.mock("@/lib/web-search/public-http", () => ({
  requestPublicResponse: mocks.requestPublicResponse,
}));

import {
  fetchLinkMetadata,
  fetchLinkPreviewImage,
  parseLinkPreviewHtml,
  probeLink,
} from "./link-preview";

const signal = new AbortController().signal;

describe("链接预览", () => {
  beforeEach(() => mocks.requestPublicResponse.mockReset());

  it("按 Open Graph、Twitter、HTML 的顺序提取元数据并解析相对资源", () => {
    const preview = parseLinkPreviewHtml(`
      <html><head>
        <title>HTML title</title>
        <meta name="twitter:title" content="Twitter title">
        <meta property="og:title" content="OG title">
        <meta name="description" content="HTML description">
        <meta property="og:description" content="OG description">
        <meta property="og:site_name" content="Example Site">
        <meta property="og:image" content="/assets/cover.jpg">
        <link rel="shortcut icon" href="icons/site.ico">
      </head></html>
    `, new URL("https://example.com/docs/page"));

    expect(preview).toMatchObject({
      title: "OG title",
      description: "OG description",
      siteName: "Example Site",
      imageUrl: "https://example.com/assets/cover.jpg",
      iconUrl: "https://example.com/docs/icons/site.ico",
    });
  });

  it("元数据缺失时从正文段落生成有限摘要并排除脚本内容", () => {
    const preview = parseLinkPreviewHtml(`
      <html><head><title>正文页</title><script>不应出现在摘要</script></head>
      <body><main><p>这是一段足够长的正文摘要,用于在外链浮层中展示页面的具体内容。</p></main>
      <script><p>secret</p></script></body></html>
    `, new URL("https://example.com/article"));

    expect(preview.description).toBe("这是一段足够长的正文摘要,用于在外链浮层中展示页面的具体内容。");
    expect(preview.description).not.toContain("不应出现在摘要");
  });

  it("探测到栅格图片 Content-Type 时返回 image", async () => {
    mocks.requestPublicResponse.mockResolvedValue({
      status: 200,
      url: new URL("https://cdn.example.com/asset?id=42"),
      headers: { "content-type": "image/png; charset=binary" },
      body: Buffer.alloc(0),
    });

    await expect(probeLink("https://cdn.example.com/asset?id=42", signal))
      .resolves.toMatchObject({ kind: "image", contentType: "image/png" });
    expect(mocks.requestPublicResponse).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({ "User-Agent": expect.stringContaining("Mozilla/5.0") }),
    }));
  });

  it("HEAD 被上游拒绝时用不读取正文的 GET 继续探测", async () => {
    mocks.requestPublicResponse
      .mockResolvedValueOnce({
        status: 403,
        url: new URL("https://cdn.example.com/asset"),
        headers: {},
        body: Buffer.alloc(0),
      })
      .mockResolvedValueOnce({
        status: 200,
        url: new URL("https://cdn.example.com/asset"),
        headers: { "content-type": "image/webp" },
        body: Buffer.alloc(0),
      });

    await expect(probeLink("https://cdn.example.com/asset", signal))
      .resolves.toMatchObject({ kind: "image" });
    expect(mocks.requestPublicResponse).toHaveBeenNthCalledWith(2, expect.any(URL), expect.objectContaining({
      readBody: false,
      signal,
    }));
  });

  it("元数据请求使用浏览器兼容请求头", async () => {
    mocks.requestPublicResponse.mockResolvedValue({
      status: 200,
      url: new URL("https://example.com/"),
      headers: { "content-type": "text/html" },
      body: Buffer.from("<title>Example</title>"),
    });

    await fetchLinkMetadata("https://example.com", signal);

    expect(mocks.requestPublicResponse).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({ "User-Agent": expect.stringContaining("Mozilla/5.0") }),
    }));
  });

  it("元数据上游非 2xx 时抛错，避免缓存空预览", async () => {
    mocks.requestPublicResponse.mockResolvedValue({
      status: 403,
      url: new URL("https://example.com/"),
      headers: { "content-type": "text/html" },
      body: Buffer.from("blocked"),
    });

    await expect(fetchLinkMetadata("https://example.com", signal))
      .rejects.toThrow("上游链接请求失败");
  });

  it("图片代理拒绝 SVG，只允许受控栅格类型", async () => {
    mocks.requestPublicResponse.mockResolvedValue({
      status: 200,
      url: new URL("https://example.com/logo.svg"),
      headers: { "content-type": "image/svg+xml" },
      body: Buffer.from("<svg></svg>"),
    });

    await expect(fetchLinkPreviewImage("https://example.com/logo.svg", signal))
      .rejects.toThrow("不支持的预览图片");
  });

  it("图片代理返回受控栅格图片", async () => {
    const body = Buffer.from("png");
    mocks.requestPublicResponse.mockResolvedValue({
      status: 200,
      url: new URL("https://example.com/cover.png"),
      headers: { "content-type": "image/png" },
      body,
    });

    await expect(fetchLinkPreviewImage("https://example.com/cover.png", signal))
      .resolves.toEqual({ body, contentType: "image/png" });
    expect(mocks.requestPublicResponse).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: expect.objectContaining({ "User-Agent": expect.stringContaining("Mozilla/5.0") }),
    }));
  });
});
