export type LinkPreviewMode = "probe" | "metadata" | "image";

export function getLinkPreviewApiUrl(mode: LinkPreviewMode, url: string): string {
  return `/api/link-preview?${new URLSearchParams({ mode, url }).toString()}`;
}

/** 外部图片经登录态同源代理加载，避免浏览器直连触发防盗链。 */
export function getProxiedMarkdownImageUrl(src: string): string {
  try {
    const url = new URL(src);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return getLinkPreviewApiUrl("image", src);
    }
  } catch {
    // 相对路径与非 URL 值保持原样。
  }
  return src;
}
