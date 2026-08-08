"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  useMemo,
  createContext,
  useContext,
  Children,
  isValidElement,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import { Check, Copy, Eye, Code, ChevronDown, ChevronUp, Globe2, Maximize, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  Streamdown,
  CodeBlock,
  type AllowedTags,
  type LinkSafetyConfig,
  type LinkSafetyModalProps,
} from "streamdown";
import { code as codeHighlighter } from "@streamdown/code";
import Modal from "@/shared/ui/Modal";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import {
  MarkdownHTMLDiv,
  MarkdownHTMLSection,
  MarkdownHTMLArticle,
  MarkdownHTMLAside,
  MarkdownHTMLMain,
  MarkdownHTMLParagraph,
  MarkdownHTMLDetails,
  MarkdownHTMLSummary,
  MarkdownHTMLSpan,
} from "./streamdown-html";
import { MarkdownImage, MarkdownImagePreviewModal } from "./MarkdownImage";
import {
  collectBareHttpUrls,
  isDirectImageUrl,
  normalizeBareImageUrls,
  normalizeHtmlBlockBlankLines,
  normalizeThematicBreakSpacing,
  parseMarkdown,
  separateBareUrlTrailingText,
  splitStructuredSegments,
} from "./customRenderer";
import { resolvePreviewableKind, type PreviewableKind } from "@/lib/artifacts/previewable";
import { resolveStructuredKind } from "@/lib/artifacts/structured";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { StructuredInlineView } from "@/shared/components/structured-blocks";
import { MermaidDiagram } from "@/shared/components/mermaid/MermaidDiagram";
import { MARKDOWN_CONTROLS, shouldCollapseCodeBlock } from "./markdownControls";
import { getLinkPreviewApiUrl, type LinkPreviewMode } from "./linkPreview";
import type { LinkPreviewData } from "@nekusora/core/link-preview";

interface MarkdownProps {
  /** 待渲染的 markdown 文本(流式增量时会持续变化)。 */
  content: string;
  /** 是否正在流式接收(true 时启用未闭合块解析,避免抖动)。 */
  isStreaming?: boolean;
  /**
   * 渲染器:streamdown(默认,支持流式/代码高亮/Mermaid)
   * 或 custom(流式结束后用内置解析器重渲,支持完整自定义 CSS 含 class 选择器)。
   * custom 仅在 isStreaming=false 时生效;流式中始终用 streamdown。
   */
  renderer?: "streamdown" | "custom";
  className?: string;
  /**
   * 代码块「预览」按钮回调;仅 html/svg/mermaid 等可预览类型才显示按钮。
   * 不传则代码块无预览按钮。
   */
  onPreview?: (payload: CodeBlockPreviewPayload) => void;
  /** 输出样式 cssClass(如 "paper"),用于按皮肤差异化代码块渲染。 */
  renderStyleClass?: string | null;
}

/** 代码块预览入口透传给 streamdown 自定义 pre 组件的载荷。 */
export type CodeBlockPreviewPayload = {
  id: string;
  kind: PreviewableKind;
  language: string;
  content: string;
  title: string;
};

interface MarkdownRenderContextValue {
  onPreview?: (payload: CodeBlockPreviewPayload) => void;
  /** 是否流式中:结构化块在此期间显示骨架,结束后才解析内联渲染。 */
  isStreaming?: boolean;
  /** 是否纸面杂志皮肤:代码块用语言/复制双态按钮、pre 撑满宽度等差异化样式。 */
  isPaper?: boolean;
}
const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);

/** 将 Streamdown 的链接确认层移出 Markdown 段落，避免块元素嵌入 <p>。 */
export function MarkdownLinkSafetyModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const t = useTranslations("markdown.linkSafety");
  if (typeof document === "undefined") return null;

  return createPortal(
    <ConfirmDialog
      open={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t("title")}
      message={(
        <div className="space-y-3">
          <p>{t("message")}</p>
          <p className="break-all rounded-md bg-nebula-silver px-3 py-2 font-mono text-ui-caption text-space-ink dark:bg-deep-space dark:text-nebula-silver">
            {url}
          </p>
        </div>
      )}
      confirmLabel={t("continue")}
      cancelLabel={t("cancel")}
      danger={false}
    />,
    document.body,
  );
}

const STREAMDOWN_LINK_SAFETY: LinkSafetyConfig = {
  // components.a 已由 MarkdownLink 接管，安全确认统一由根级事件委托处理。
  enabled: false,
};

const linkPreviewRequests = new Map<string, Promise<LinkPreviewData | null>>();
const EMPTY_IMAGE_URLS: ReadonlySet<string> = new Set();

export function requestLinkPreview(mode: Exclude<LinkPreviewMode, "image">, url: string): Promise<LinkPreviewData | null> {
  const key = `${mode}:${url}`;
  const cached = linkPreviewRequests.get(key);
  if (cached) return cached;
  const request = fetch(getLinkPreviewApiUrl(mode, url), { credentials: "same-origin" })
    .then(async (response) => response.ok ? await response.json() as LinkPreviewData : null)
    .catch(() => null)
    .then((result) => {
      if (!result) linkPreviewRequests.delete(key);
      return result;
    });
  linkPreviewRequests.set(key, request);
  return request;
}

interface MarkdownLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  node?: unknown;
}

interface LinkPreviewTarget {
  anchor: HTMLAnchorElement;
  href: string;
}

interface LinkPreviewResult {
  href: string;
  data: LinkPreviewData;
}

interface MarkdownLinkPreviewLayerProps {
  children: ReactNode;
}

function getHttpUrl(href?: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return href;
  } catch {
    return null;
  }
}

function getPreviewableExternalUrl(href?: string): string | null {
  const httpUrl = getHttpUrl(href);
  if (!httpUrl) return null;
  if (typeof window !== "undefined" && new URL(httpUrl).origin === window.location.origin) return null;
  return httpUrl;
}

function containsMarkdownImage(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (!isValidElement<{ node?: { tagName?: string } }>(child)) return false;
    return child.type === MarkdownImage || child.props.node?.tagName === "img";
  });
}

/** Streamdown 链接组件:给根级安全确认和 hover 浮层提供触发 URL。 */
function MarkdownLink({ children, href, node: _node, onClick, ...props }: MarkdownLinkProps) {
  const httpUrl = getHttpUrl(href);
  const previewUrl = containsMarkdownImage(children) ? null : httpUrl;

  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel={props.rel ?? "noreferrer"}
      data-streamdown="link"
      data-preview-url={previewUrl ?? undefined}
      data-safety-url={httpUrl ?? undefined}
      onClick={(event) => {
        if (!href || href === "streamdown:incomplete-link") event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}

function getPreviewTarget(eventTarget: EventTarget | null): HTMLAnchorElement | null {
  if (!(eventTarget instanceof Element)) return null;
  const anchor = eventTarget.closest<HTMLAnchorElement>("a[data-preview-url]");
  return anchor?.dataset.previewUrl ? anchor : null;
}

function getSafetyTarget(eventTarget: EventTarget | null): HTMLAnchorElement | null {
  if (!(eventTarget instanceof Element)) return null;
  const anchor = eventTarget.closest<HTMLAnchorElement>("a[data-safety-url]");
  return anchor?.dataset.safetyUrl ? anchor : null;
}

/** 跨 Streamdown/custom 的根级链接浮层,避免 raw HTML 路径重复维护 React 链接树。 */
function MarkdownLinkPreviewLayer({ children }: MarkdownLinkPreviewLayerProps) {
  const t = useTranslations("markdown.linkPreview");
  const tooltipId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [target, setTarget] = useState<LinkPreviewTarget | null>(null);
  const [previewResult, setPreviewResult] = useState<LinkPreviewResult | null>(null);
  const [confirmUrl, setConfirmUrl] = useState("");

  const clearCloseTimer = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setTarget(null), 150);
  };

  const showTarget = (anchor: HTMLAnchorElement) => {
    const href = getPreviewableExternalUrl(anchor.dataset.previewUrl);
    if (!href) return;
    clearCloseTimer();
    setTarget({ anchor, href });
    void requestLinkPreview("metadata", href).then((data) => {
      if (data) setPreviewResult({ href, data });
    });
  };

  const handlePointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    const anchor = getPreviewTarget(event.target);
    if (!anchor) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    showTarget(anchor);
  };

  const handlePointerOut = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!target) return;
    if (event.relatedTarget instanceof Node && target.anchor.contains(event.relatedTarget)) return;
    scheduleClose();
  };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!target || !panel) return;
    let raf = 0;
    const position = () => {
      if (!target.anchor.isConnected) {
        panel.style.visibility = "hidden";
        return;
      }
      const rect = target.anchor.getBoundingClientRect();
      const gap = 8;
      const margin = 8;
      let left = rect.left;
      let top = rect.bottom + gap;
      if (top + panel.offsetHeight > window.innerHeight - margin) top = rect.top - panel.offsetHeight - gap;
      left = Math.max(margin, Math.min(left, window.innerWidth - panel.offsetWidth - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - panel.offsetHeight - margin));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    const schedulePosition = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; position(); });
    };
    panel.style.visibility = "hidden";
    position();
    const resizeObserver = new ResizeObserver(schedulePosition);
    resizeObserver.observe(target.anchor);
    resizeObserver.observe(panel);
    window.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", schedulePosition, true);
      window.removeEventListener("resize", schedulePosition);
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    target.anchor.setAttribute("aria-describedby", tooltipId);
    return () => {
      if (target.anchor.getAttribute("aria-describedby") === tooltipId) {
        target.anchor.removeAttribute("aria-describedby");
      }
    };
  }, [target, tooltipId]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const previewHost = target ? new URL(target.href).hostname : "";
  const preview = target && previewResult?.href === target.href ? previewResult.data : null;
  return (
    <>
      <div
        className="contents [&>*:first-child>*:first-child]:mt-0"
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClickCapture={(event) => {
          const anchor = getSafetyTarget(event.target);
          const href = getPreviewableExternalUrl(anchor?.dataset.safetyUrl);
          if (!href) return;
          event.preventDefault();
          setConfirmUrl(href);
          setTarget(null);
        }}
        onFocusCapture={(event) => {
          const anchor = getPreviewTarget(event.target);
          if (anchor) showTarget(anchor);
        }}
        onBlurCapture={(event) => {
          if (event.relatedTarget instanceof Node && (
            event.currentTarget.contains(event.relatedTarget) || panelRef.current?.contains(event.relatedTarget)
          )) return;
          scheduleClose();
        }}
      >
        {children}
      </div>
      {target && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          id={tooltipId}
          role="tooltip"
          aria-live="polite"
          className="fixed z-50 w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-morning-mist bg-white text-space-ink shadow-md dark:border-deep-space dark:bg-space-ink dark:text-nebula-silver"
          style={{ visibility: "hidden" }}
          onPointerEnter={clearCloseTimer}
          onPointerLeave={scheduleClose}
        >
          {preview?.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getLinkPreviewApiUrl("image", preview.imageUrl)}
              alt=""
              className="h-36 w-full border-b border-morning-mist object-cover dark:border-deep-space"
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          )}
          <div className="p-3">
            <div className="flex items-center gap-2 text-ui-caption text-neutral-600 dark:text-neutral-300">
              {preview?.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getLinkPreviewApiUrl("image", preview.iconUrl)}
                  alt=""
                  className="h-4 w-4 shrink-0 rounded-sm object-contain"
                  onError={(event) => { event.currentTarget.hidden = true; }}
                />
              ) : (
                <Globe2 className="h-4 w-4 shrink-0 text-sora-blue" aria-hidden="true" />
              )}
              <span className="sr-only">{t("title")}: </span>
              <span className="truncate">{preview?.siteName || previewHost}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-ui-body font-semibold text-space-ink dark:text-nebula-silver">
              {preview?.title || previewHost}
            </p>
            {preview?.description && (
              <p className="mt-1 line-clamp-3 text-ui-caption leading-5 text-neutral-600 dark:text-neutral-300">
                {preview.description}
              </p>
            )}
            <p className="mt-2 truncate text-ui-caption text-neutral-500 dark:text-neutral-400">
              {preview?.url || target.href}
            </p>
          </div>
        </div>,
        document.body,
      )}
      <MarkdownLinkSafetyModal
        isOpen={Boolean(confirmUrl)}
        onClose={() => setConfirmUrl("")}
        onConfirm={() => {
          if (confirmUrl) window.open(confirmUrl, "_blank", "noreferrer");
          setConfirmUrl("");
        }}
        url={confirmUrl}
      />
    </>
  );
}

/**
 * 放行 HTML 块标签及其 style 属性的白名单。
 * streamdown 内部据此扩展 rehype-sanitize schema,使 AI 输出的
 * 带样式 HTML(如多色卡片布局)能被解析;style 的安全过滤由
 * streamdown-html 的自定义组件承担。
 */
const ALLOWED_HTML_TAGS: AllowedTags = {
  div: ["style"],
  span: ["style"],
  p: ["style"],
  section: ["style"],
  article: ["style"],
  aside: ["style"],
  main: ["style"],
  details: ["open", "style"],
  summary: ["style"],
};

/** 自定义组件映射:对放行的 HTML 标签做 style 安全过滤 + 代码块叠加预览按钮。 */
const STREAMDOWN_COMPONENTS = {
  div: MarkdownHTMLDiv,
  section: MarkdownHTMLSection,
  article: MarkdownHTMLArticle,
  aside: MarkdownHTMLAside,
  main: MarkdownHTMLMain,
  p: MarkdownHTMLParagraph,
  details: MarkdownHTMLDetails,
  summary: MarkdownHTMLSummary,
  span: MarkdownHTMLSpan,
  a: MarkdownLink,
  pre: MarkdownCodeBlock,
  img: MarkdownImage,
};

/** 从 code 元素的 className 提取语言标识(language-xxx → xxx)。 */
function getCodeLanguage(className?: string): string {
  if (!className) return "";
  const m = /language-([^\s]+)/.exec(className);
  return m?.[1] ?? "";
}

/** 计算代码块行数(去掉末尾换行后按 \n 分割)。 */
function getLineCount(value: string): number {
  if (!value) return 0;
  return value.replace(/\n$/, "").split("\n").length;
}

/** 递归提取 React 节点的纯文本(从 code 元素取源码,跳过 Shiki token span)。 */
function getNodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return getNodeText(child.props.children);
      }
      return "";
    })
    .join("");
}

/** 简单字符串 hash,给就地构造的预览 artifact 生成稳定 id(mermaid 渲染 key 等)。 */
function quickHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function inferPreviewTitle(language: string, code: string): string {
  const firstLine = code.split("\n")[0]?.trim().replace(/[#`*]/g, "").slice(0, 40) ?? "";
  return firstLine || `${language || "snippet"}`;
}

type PreChildProps = { className?: string; children?: ReactNode; "data-block"?: string };

/**
 * 自定义 streamdown pre 组件:对结构化代码块(chart/metric/table)正文内联渲染,
 * 对可预览代码块(html/svg/mermaid)在右上角叠加「预览」按钮,其余用 streamdown
 * CodeBlock 渲染(Shiki 高亮 + 块状 wrapper + 超过 16 行折叠)。
 * 仅处理 fenced code block(streamdown 传入的 children 为单个 code 元素);
 * 行内 code 走 streamdown 的 inlineCode,不受影响。
 */
function MarkdownCodeBlock({
  children,
  node: _node,
}: HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  const ctx = useContext(MarkdownRenderContext);
  const onPreview = ctx?.onPreview;
  const isStreaming = ctx?.isStreaming ?? false;
  const isPaper = ctx?.isPaper ?? false;
  const t = useTranslations("artifacts");
  const [copied, setCopied] = useState(false);
  const [expandedCodeHash, setExpandedCodeHash] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 代码块折叠/展开过渡:外层包裹 ref + 展开态实测高度(见下方 useLayoutEffect)
  const bodyWrapRef = useRef<HTMLDivElement>(null);
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);

  const childArr = Children.toArray(children);
  const firstChild = childArr[0];
  const codeEl =
    childArr.length === 1 && isValidElement<PreChildProps>(firstChild) ? firstChild : null;
  const language = codeEl ? getCodeLanguage(codeEl.props.className) : "";
  const code = codeEl ? getNodeText(codeEl.props.children) : "";
  const codeHash = quickHash(code);
  const expanded = expandedCodeHash === codeHash;

  // 结构化块识别(chart/metric/table),与 html/svg/mermaid 预览互斥。
  const structuredKind = resolveStructuredKind(language);

  const kind = resolvePreviewableKind(language, code);
  const canCopy = Boolean(code.trim());
  const lineCount = getLineCount(code);
  const isCollapsible = shouldCollapseCodeBlock(lineCount, isStreaming);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // 折叠/展开过渡:展开态测量真实内容高度作为 maxHeight,使 max-height 在 22rem <-> 实际高度间可插值
  // (max-height 到 none 不可过渡,直接移除上限会瞬变)。展开但尚未测得时先保持 22rem,避免撑开闪烁。
  useLayoutEffect(() => {
    if (!isCollapsible || !expanded) return;
    const el = bodyWrapRef.current;
    if (!el) return;
    setExpandedHeight(el.scrollHeight);
  }, [expanded, isCollapsible, code]);

  // 宽度变化导致代码换行变化时,展开态高度随之更新(观察 body 内容元素,不受外层 maxHeight 影响)
  useEffect(() => {
    if (!expanded || !isCollapsible) return;
    const wrap = bodyWrapRef.current;
    if (!wrap) return;
    const body = wrap.querySelector<HTMLElement>("[data-streamdown='code-block-body']");
    if (!body) return;
    const ro = new ResizeObserver(() => setExpandedHeight(wrap.scrollHeight));
    ro.observe(body);
    return () => ro.disconnect();
  }, [expanded, isCollapsible]);

  async function handleCopy() {
    const ok = await copyToClipboard(code);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  }

  // 结构化块:三态(骨架/成功/降级)集中在 StructuredInlineView。
  if (structuredKind) {
    return <StructuredInlineView kind={structuredKind} raw={code} isStreaming={isStreaming} />;
  }

  // mermaid:默认内联渲染成图(流式中显示源码),点按在 图/源码 间切换;
  // 取代旧的"源码 + 打开右侧面板预览"。svg/html 仍走下方预览链路。
  if (kind === "mermaid" && code.trim()) {
    return <MermaidInlineBlock code={code} isStreaming={isStreaming} />;
  }

  // 以下:非结构化源码 / html-svg-mermaid 预览。
  const canPreview = Boolean(kind && onPreview && code.trim());

  return (
    <div className="group relative">
      {isPaper ? (
        // paper:右上角语言标签小块(半透明白底适配深色 pre),hover/触屏切换为复制/预览按钮。
        <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-ui-caption font-mono backdrop-blur-sm">
          <span className="text-white/60 group-hover:hidden [@media(pointer:coarse)]:hidden">
            {language || "text"}
          </span>
          {canPreview && kind && onPreview ? (
            <button
              type="button"
              onClick={() =>
                onPreview({
                  id: `preview-${kind}-${quickHash(code)}`,
                  kind,
                  language,
                  content: code,
                  title: inferPreviewTitle(language, code),
                })
              }
              className="hidden h-5 w-5 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white group-hover:inline-flex [@media(pointer:coarse)]:inline-flex focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
              title={t("openPreview")}
              aria-label={t("openPreview")}
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          ) : null}
          {canCopy ? (
            <button
              type="button"
              onClick={handleCopy}
              className="hidden h-5 w-5 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white group-hover:inline-flex [@media(pointer:coarse)]:inline-flex focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
              title={copied ? t("copied") : t("copy")}
              aria-label={copied ? t("copied") : t("copy")}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>
      ) : (
        (canCopy || (canPreview && kind && onPreview)) ? (
          <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-space-ink/80 px-1 py-1 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
            {canPreview && kind && onPreview ? (
              <button
                type="button"
                onClick={() =>
                  onPreview({
                    id: `preview-${kind}-${quickHash(code)}`,
                    kind,
                    language,
                    content: code,
                    title: inferPreviewTitle(language, code),
                  })
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                title={t("openPreview")}
                aria-label={t("openPreview")}
              >
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : null}
            {canCopy ? (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
                title={copied ? t("copied") : t("copy")}
                aria-label={copied ? t("copied") : t("copy")}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>
        ) : null
      )}
      <div
        ref={bodyWrapRef}
        className={clsx(
          "transition-[max-height] duration-300 ease-out",
          isCollapsible && "overflow-hidden",
        )}
        style={{
          maxHeight: !isCollapsible
            ? undefined
            : !expanded
              ? "22rem"
              : expandedHeight ?? "22rem",
        }}
      >
        <CodeBlock
          code={code}
          language={language || "text"}
          lineNumbers={false}
          isIncomplete={isStreaming}
        />
      </div>
      {isCollapsible && !expanded ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 h-20 bg-gradient-to-b from-transparent via-[var(--color-prose-code-bg)]/70 to-[var(--color-prose-code-bg)]" />
      ) : null}
      {isCollapsible ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setExpandedCodeHash((value) => value === codeHash ? null : codeHash)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-ui-caption font-medium text-neutral-500 hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white transition-colors cursor-pointer"
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {expanded ? t("codeCollapse") : t("codeExpand", { count: lineCount })}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Mermaid 内联块:默认渲染成图,流式中或用户切换时显示源码。
 *
 * 与 html/svg 不同,mermaid"看渲染结果才有意义",故正文直接出图而非只给源码;
 * 右上角按钮在「代码」(源码)与「预览」(图表)间切换。流式中图不完整会解析失败,
 * 故流式期间强制显示源码,流结束后自动转为图。外层带边框容器图/源码共用,切换无布局跳动。
 */
function MermaidInlineBlock({ code, isStreaming }: { code: string; isStreaming: boolean }) {
  const t = useTranslations("artifacts");
  // 唯一 id:mermaid.render 内部据此建 DOM 节点,实例间不可重复(否则渲染冲突)。
  const reactId = useId();
  const id = useMemo(() => "m" + reactId.replace(/[^a-zA-Z0-9]/g, ""), [reactId]);
  const [view, setView] = useState<"diagram" | "source">("diagram");
  // 流式中强制源码(图不完整会解析失败);流结束后回到用户选择(默认 diagram)。
  const showSource = isStreaming || view === "source";
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); }, []);

  // 全屏查看(仅图模式有意义;源码模式不放大)。复用 MermaidViewerModal,内含 panZoom。
  const [fullscreen, setFullscreen] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(code);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  }

  return (
    <>
    <div className="group relative my-2">
      <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-space-ink/80 px-1 py-1 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <button
          type="button"
          onClick={() => setView((v) => (v === "diagram" ? "source" : "diagram"))}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
          title={showSource ? t("preview") : t("code")}
          aria-label={showSource ? t("preview") : t("code")}
        >
          {showSource ? (
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Code className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
          title={copied ? t("copied") : t("copy")}
          aria-label={copied ? t("copied") : t("copy")}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
          ) : (
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
        {!showSource && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
            title={t("fullscreen")}
            aria-label={t("fullscreen")}
          >
            <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="max-h-[36rem] overflow-auto rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink p-3">
        {showSource ? (
          <pre className="text-ui-caption leading-relaxed font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre">
            <code>{code}</code>
          </pre>
        ) : (
          <MermaidDiagram
            id={id}
            content={code}
            className="mermaid-inline-diagram w-full [&_svg]:!h-auto [&_svg]:!w-full [&_svg]:!max-w-none"
            preserveContentScale
          />
        )}
      </div>
    </div>
      <MermaidViewerModal
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        code={code}
        id={`${id}-fullscreen`}
      />
    </>
  );
}

/**
 * Mermaid 全屏查看器:复用 Modal,通过 Portal 脱离正文输出样式,内含 panZoom(滚轮缩放 + 拖拽平移)。
 * 独立 id 避免与内联图 mermaid.render DOM 冲突;ESC/遮罩/关闭按钮关闭(Modal 内置)。
 */
function MermaidViewerModal({ open, onClose, code, id }: { open: boolean; onClose: () => void; code: string; id: string }) {
  const t = useTranslations("artifacts");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <Modal
      open
      onClose={() => { reset(); onClose(); }}
      title={t("mermaidDiagram")}
      dialogClassName="m-auto w-[min(1100px,94vw)] max-h-[92vh] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/50 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver"
      bodyClassName="p-0 h-[82vh] overflow-hidden relative"
    >
      <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-space-ink/80 px-1 py-1 backdrop-blur-sm">
        <button type="button" onClick={() => setScale((s) => Math.min(5, +(s + 0.2).toFixed(2)))} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 cursor-pointer" title={t("zoomIn")} aria-label={t("zoomIn")}>
          <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setScale((s) => Math.max(0.3, +(s - 0.2).toFixed(2)))} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 cursor-pointer" title={t("zoomOut")} aria-label={t("zoomOut")}>
          <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" onClick={reset} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 cursor-pointer" title={t("resetView")} aria-label={t("resetView")}>
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <div
        className="h-full w-full flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
        onWheel={(e) => { setScale((s) => Math.max(0.3, Math.min(5, +(s + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(2)))); }}
        onPointerDown={(e) => { dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (dragging.current) setOffset({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y }); }}
        onPointerUp={() => { dragging.current = null; }}
      >
        <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} className="origin-center">
          <MermaidDiagram id={id} content={code} />
        </div>
      </div>
    </Modal>,
    document.body,
  );
}

function StaticMarkdown({ children }: { children: string }) {
  return (
    <Streamdown
      mode="static"
      controls={MARKDOWN_CONTROLS}
      linkSafety={STREAMDOWN_LINK_SAFETY}
      allowedTags={ALLOWED_HTML_TAGS}
      components={STREAMDOWN_COMPONENTS}
      shikiTheme={["github-light", "github-dark"]}
      plugins={{ code: codeHighlighter }}
      lineNumbers={false}
    >
      {children}
    </Streamdown>
  );
}

const STANDALONE_MARKDOWN_IMAGE_RE = /^\s*!\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)\)\s*$/;

function CustomMarkdownSegment({ children }: { children: string }) {
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string; title?: string } | null>(null);
  const blocks: Array<{ type: "markdown" | "streamdown"; value: string }> = [];
  let markdownLines: string[] = [];
  const flushMarkdown = () => {
    const value = markdownLines.join("\n");
    if (value.trim()) blocks.push({ type: "markdown", value });
    markdownLines = [];
  };

  children.split("\n").forEach((line) => {
    // 独占图片行保留 Streamdown 的加载/失败/放大交互;列表内图片必须与列表一起解析。
    if (STANDALONE_MARKDOWN_IMAGE_RE.test(line)) {
      flushMarkdown();
      blocks.push({ type: "streamdown", value: line });
    } else {
      markdownLines.push(line);
    }
  });
  flushMarkdown();

  const openPreview = (eventTarget: EventTarget | null) => {
    if (!(eventTarget instanceof Element)) return false;
    const image = eventTarget.closest<HTMLImageElement>("img[data-markdown-image-url]");
    const src = image?.dataset.markdownImageUrl;
    if (!image || !src) return false;
    setPreviewImage({ src, alt: image.alt, title: image.title || undefined });
    return true;
  };

  return (
    <>
      {blocks.map((block, index) => block.type === "streamdown" ? (
        <StaticMarkdown key={`streamdown-${index}`}>{block.value}</StaticMarkdown>
      ) : (
        <div
          key={`markdown-${index}`}
          onClick={(event) => { openPreview(event.target); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            if (openPreview(event.target)) event.preventDefault();
          }}
          dangerouslySetInnerHTML={{ __html: parseMarkdown(block.value) }}
        />
      ))}
      {previewImage && (
        <MarkdownImagePreviewModal
          open
          onClose={() => setPreviewImage(null)}
          src={previewImage.src}
          alt={previewImage.alt}
          title={previewImage.title}
        />
      )}
    </>
  );
}

/**
 * 流式友好的 Markdown 渲染组件(streamdown 封装)。
 *
 * 相比 react-markdown 的优势:
 *   - 流式优化:isStreaming 时启用 remend 补全未闭合的代码块/表格(见 parseIncompleteMarkdown),不闪烁
 *   - 内置 GFM(表格/任务列表/删除线)+ Mermaid 图 + Shiki 代码高亮
 *   - 安全:内置 rehype-harden 防 XSS
 *   - 放行 AI 输出的带样式 HTML 块,style 经中性色映射(color 纯黑白->currentColor,适配暗色),其余原样透传
 *
 * 用法:
 *   <Markdown content={msg.content} isStreaming={streaming} />
 *
 * 注:Tailwind 类扫描配置见 globals.css 的 @source 指令。
 */
function MarkdownImpl({ content, isStreaming, renderer = "streamdown", className, onPreview, renderStyleClass }: MarkdownProps) {
  const separatedContent = useMemo(() => separateBareUrlTrailingText(content), [content]);
  const probeCandidates = useMemo(() => (
    isStreaming
      ? []
      : collectBareHttpUrls(separatedContent).filter((url) => !isDirectImageUrl(url))
  ), [isStreaming, separatedContent]);
  const probeKey = probeCandidates.join("\n");
  const [probedImages, setProbedImages] = useState<{
    key: string;
    urls: ReadonlySet<string>;
  }>({ key: "", urls: EMPTY_IMAGE_URLS });

  useEffect(() => {
    if (!probeKey) return;
    let active = true;
    void Promise.all(probeCandidates.map(async (url) => ({
      url,
      preview: await requestLinkPreview("probe", url),
    }))).then((results) => {
      if (!active) return;
      setProbedImages({
        key: probeKey,
        urls: new Set(results.filter(({ preview }) => preview?.kind === "image").map(({ url }) => url)),
      });
    });
    return () => { active = false; };
  }, [probeCandidates, probeKey]);

  // custom 渲染器:仅在流式结束后启用(流式中 streamdown 更稳)。原样渲染 AI 的 HTML/class。
  const useCustom = renderer === "custom" && !isStreaming;
  const isPaper = renderStyleClass === "paper";
  const confirmedImageUrls = probedImages.key === probeKey ? probedImages.urls : EMPTY_IMAGE_URLS;
  const normalizedContent = normalizeThematicBreakSpacing(
    isStreaming
      ? separatedContent
      : normalizeBareImageUrls(separatedContent, confirmedImageUrls),
  );

  if (useCustom) {
    // 按结构化代码块分段:结构化段用受控组件内联渲染,代码块用 Streamdown
    // 渲染(Shiki 高亮 + 块状,与默认渲染器一致),其余段用 parseMarkdown,
    // 使「输出样式」(如纸面杂志)也能展示 chart/metric/table 且代码块保留高亮。
    const segments = splitStructuredSegments(normalizedContent);
    return (
      <div className={clsx("nekusora-md", className)}>
        <MarkdownRenderContext.Provider value={{ onPreview, isStreaming, isPaper }}>
          <MarkdownLinkPreviewLayer>
            {segments.map((seg, i) =>
              seg.type === "structured" ? (
                <StructuredInlineView key={i} kind={seg.kind} raw={seg.raw} />
              ) : seg.type === "mermaid" ? (
                <MermaidInlineBlock key={i} code={seg.raw} isStreaming={false} />
              ) : seg.type === "code" ? (
                <StaticMarkdown key={i}>{"```" + seg.language + "\n" + seg.raw + "\n```"}</StaticMarkdown>
              ) : (
                <CustomMarkdownSegment key={i}>{seg.text}</CustomMarkdownSegment>
              ),
            )}
          </MarkdownLinkPreviewLayer>
        </MarkdownRenderContext.Provider>
      </div>
    );
  }

  const streamdownContent = normalizeHtmlBlockBlankLines(normalizedContent);
  const streamdown = (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      // 流式不再启用逐字 fadeIn:A/B 实测在弱硬件(60Hz)上 on 比 off 多 ~48% 掉帧、min FPS 更低;
      // 而 fadeIn 在正常/快 token 速率下肉眼本就不可见(两次 harness 对照均「差不多」),性价比低。
      // 流式感改由「字逐帧增加(store rAF 合批)+ 末尾光标」承担。
      animated={false}
      // 启用 remend 对不完整 markdown 的补全:streamdown 源码里补全条件是 mode==="streaming" && parseIncompleteMarkdown,
      // 二者缺一不可;仅传 mode="streaming" 不会补全,未闭合的代码块/表格会渲染崩坏、闪烁。
      parseIncompleteMarkdown={isStreaming}
      caret={isStreaming ? "block" : undefined}
      allowedTags={ALLOWED_HTML_TAGS}
      components={STREAMDOWN_COMPONENTS}
      controls={MARKDOWN_CONTROLS}
      linkSafety={STREAMDOWN_LINK_SAFETY}
      plugins={{ code: codeHighlighter }}
      shikiTheme={["github-light", "github-dark"]}
    >
      {streamdownContent}
    </Streamdown>
  );

  return (
    <div className={clsx("nekusora-md", className)}>
      <MarkdownRenderContext.Provider value={{ onPreview, isStreaming, isPaper }}>
        <MarkdownLinkPreviewLayer>{streamdown}</MarkdownLinkPreviewLayer>
      </MarkdownRenderContext.Provider>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
