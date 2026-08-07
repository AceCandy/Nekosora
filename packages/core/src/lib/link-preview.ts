import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { requestPublicResponse } from "@/lib/web-search/public-http";

const HTML_LIMIT = 256 * 1024;
const IMAGE_LIMIT = 3 * 1024 * 1024;
const BROWSER_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const RASTER_IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const PROXY_IMAGE_TYPES = new Set([
  ...RASTER_IMAGE_TYPES,
  "image/vnd.microsoft.icon",
  "image/x-icon",
]);

export interface LinkPreviewData {
  url: string;
  kind: "html" | "image" | "other";
  contentType: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  iconUrl: string | null;
}

export interface LinkPreviewImage {
  body: Buffer;
  contentType: string;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeContentType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function normalizeRemoteUrl(input: string): URL {
  const url = new URL(input);
  url.hash = "";
  return url;
}

function responseKind(contentType: string | null): LinkPreviewData["kind"] {
  if (contentType && RASTER_IMAGE_TYPES.has(contentType)) return "image";
  if (contentType === "text/html" || contentType === "application/xhtml+xml") return "html";
  return "other";
}

function emptyPreview(url: URL, contentType: string | null): LinkPreviewData {
  return {
    url: url.toString(),
    kind: responseKind(contentType),
    contentType,
    title: null,
    description: null,
    siteName: null,
    imageUrl: null,
    iconUrl: null,
  };
}

async function requestHeaders(input: string, signal: AbortSignal) {
  const url = normalizeRemoteUrl(input);
  let response = await requestPublicResponse(url, {
    headers: BROWSER_REQUEST_HEADERS,
    method: "HEAD",
    readBody: false,
    signal,
  });
  if (response.status < 200 || response.status >= 300) {
    response = await requestPublicResponse(url, {
      headers: BROWSER_REQUEST_HEADERS,
      readBody: false,
      signal,
    });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("上游链接请求失败");
  }
  return response;
}

export async function probeLink(input: string, signal: AbortSignal): Promise<LinkPreviewData> {
  const response = await requestHeaders(input, signal);
  const contentType = normalizeContentType(firstHeader(response.headers["content-type"]));
  return emptyPreview(response.url, contentType);
}

function compactText(value: string | null | undefined, maxLength: number): string | null {
  const compact = value?.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, maxLength) : null;
}

function getAttribute(node: DefaultTreeAdapterTypes.Element, name: string): string | null {
  return node.attrs.find((attribute) => attribute.name.toLowerCase() === name)?.value ?? null;
}

function textContent(node: DefaultTreeAdapterTypes.Node): string {
  if ("value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(textContent).join("");
}

const NON_CONTENT_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);

/** 提取可作为摘要的正文文本,排除脚本、样式和不可见模板节点。 */
function visibleTextContent(node: DefaultTreeAdapterTypes.Node): string {
  if ("tagName" in node && NON_CONTENT_TAGS.has(node.tagName.toLowerCase())) return "";
  if ("value" in node) return typeof node.value === "string" ? node.value : "";
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(visibleTextContent).join("");
}

function pickDescription(candidates: readonly (string | null)[]): string | null {
  const values = candidates.filter((value): value is string => Boolean(value));
  return values.find((value) => value.length >= 48) ?? values[0] ?? null;
}

function toAbsoluteHttpUrl(value: string | null, pageUrl: URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseLinkPreviewHtml(
  html: string,
  pageUrl: URL,
  contentType = "text/html",
): LinkPreviewData {
  const document = parse(html);
  const metadata = new Map<string, string>();
  let documentTitle: string | null = null;
  let iconHref: string | null = null;
  const semanticParagraphs: string[] = [];
  const paragraphs: string[] = [];
  const semanticContainers: string[] = [];
  let bodyText: string | null = null;

  const visit = (node: DefaultTreeAdapterTypes.Node, inSemanticContainer = false) => {
    const tagName = "tagName" in node ? node.tagName.toLowerCase() : null;
    const isSemanticContainer = inSemanticContainer || tagName === "main" || tagName === "article";
    if ("tagName" in node) {
      if (node.tagName === "meta") {
        const key = (getAttribute(node, "property") ?? getAttribute(node, "name"))?.toLowerCase();
        const value = getAttribute(node, "content");
        if (key && value && !metadata.has(key)) metadata.set(key, value);
      } else if (node.tagName === "title" && !documentTitle) {
        documentTitle = textContent(node);
      } else if (node.tagName === "link" && !iconHref) {
        const rel = getAttribute(node, "rel")?.toLowerCase().split(/\s+/) ?? [];
        if (rel.includes("icon")) iconHref = getAttribute(node, "href");
      }
      if (tagName === "p") {
        const paragraph = compactText(visibleTextContent(node), 800);
        if (paragraph) (isSemanticContainer ? semanticParagraphs : paragraphs).push(paragraph);
      } else if (tagName === "main" || tagName === "article") {
        const container = compactText(visibleTextContent(node), 800);
        if (container) semanticContainers.push(container);
      } else if (tagName === "body" && !bodyText) {
        bodyText = compactText(visibleTextContent(node), 800);
      }
    }
    if ("childNodes" in node) node.childNodes.forEach((child) => visit(child, isSemanticContainer));
  };
  visit(document);

  const image = metadata.get("og:image") ?? metadata.get("twitter:image")
    ?? metadata.get("twitter:image:src");
  return {
    url: pageUrl.toString(),
    kind: "html",
    contentType,
    title: compactText(
      metadata.get("og:title") ?? metadata.get("twitter:title") ?? documentTitle,
      300,
    ),
    description: compactText(
      metadata.get("og:description") ?? metadata.get("twitter:description")
        ?? metadata.get("description"),
      800,
    ) ?? pickDescription([
      ...semanticParagraphs,
      ...paragraphs,
      ...semanticContainers,
      bodyText,
    ]),
    siteName: compactText(metadata.get("og:site_name"), 200),
    imageUrl: toAbsoluteHttpUrl(image ?? null, pageUrl),
    iconUrl: toAbsoluteHttpUrl(iconHref ?? "/favicon.ico", pageUrl),
  };
}

function decodeHtml(body: Buffer, contentType: string | null): string {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder().decode(body);
  }
}

export async function fetchLinkMetadata(
  input: string,
  signal: AbortSignal,
): Promise<LinkPreviewData> {
  const response = await requestPublicResponse(normalizeRemoteUrl(input), {
    signal,
    maxResponseBytes: HTML_LIMIT,
    truncateBody: true,
    headers: {
      ...BROWSER_REQUEST_HEADERS,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    },
  });
  const rawContentType = firstHeader(response.headers["content-type"]);
  const contentType = normalizeContentType(rawContentType);
  const fallback = emptyPreview(response.url, contentType);
  if (response.status < 200 || response.status >= 300) throw new Error("上游链接请求失败");
  if (fallback.kind !== "html") return fallback;
  return parseLinkPreviewHtml(decodeHtml(response.body, rawContentType), response.url, contentType ?? "text/html");
}

export async function fetchLinkPreviewImage(
  input: string,
  signal: AbortSignal,
): Promise<LinkPreviewImage> {
  const response = await requestPublicResponse(normalizeRemoteUrl(input), {
    signal,
    maxResponseBytes: IMAGE_LIMIT,
    headers: {
      ...BROWSER_REQUEST_HEADERS,
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon",
    },
  });
  const contentType = normalizeContentType(firstHeader(response.headers["content-type"]));
  if (
    response.status < 200
    || response.status >= 300
    || !contentType
    || !PROXY_IMAGE_TYPES.has(contentType)
  ) {
    throw new Error("不支持的预览图片");
  }
  return { body: response.body, contentType };
}
