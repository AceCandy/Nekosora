"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  useId,
  useMemo,
  createContext,
  useContext,
  Children,
  cloneElement,
  isValidElement,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import { Check, Copy, Eye, Code } from "lucide-react";
import { useTranslations } from "next-intl";
import { Streamdown, type AllowedTags } from "streamdown";
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
import { parseMarkdown, splitStructuredSegments } from "./customRenderer";
import { resolvePreviewableKind, type PreviewableKind } from "@/lib/artifacts/previewable";
import { resolveStructuredKind } from "@/lib/artifacts/structured";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { StructuredInlineView } from "@/shared/components/structured-blocks";
import { MermaidDiagram } from "@/shared/components/mermaid/MermaidDiagram";
import { MARKDOWN_CONTROLS } from "./markdownControls";

interface MarkdownProps {
  /** 待渲染的 markdown 文本(流式增量时会持续变化)。 */
  content: string;
  /** 是否正在流式接收(true 时启用未闭合块解析,避免抖动)。 */
  isStreaming?: boolean;
  /**
   * 渲染器:streamdown(默认,支持流式/代码高亮/KaTeX/Mermaid)
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
}
const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);

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
  pre: MarkdownCodeBlock,
};

/** 从 code 元素的 className 提取语言标识(language-xxx → xxx)。 */
function getCodeLanguage(className?: string): string {
  if (!className) return "";
  const m = /language-([^\s]+)/.exec(className);
  return m?.[1] ?? "";
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
 * 对可预览代码块(html/svg/mermaid)在右上角叠加「预览」按钮,其余正常显示源码。
 * 仅处理 fenced code block(streamdown 传入的 children 为单个 code 元素);
 * 行内 code 走 streamdown 的 inlineCode,不受影响。
 */
function MarkdownCodeBlock({
  children,
  node: _node,
  ...rest
}: HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  const ctx = useContext(MarkdownRenderContext);
  const onPreview = ctx?.onPreview;
  const isStreaming = ctx?.isStreaming ?? false;
  const t = useTranslations("artifacts");
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const childArr = Children.toArray(children);
  const firstChild = childArr[0];
  const codeEl =
    childArr.length === 1 && isValidElement<PreChildProps>(firstChild) ? firstChild : null;
  const language = codeEl ? getCodeLanguage(codeEl.props.className) : "";
  const code = codeEl ? getNodeText(codeEl.props.children) : "";

  // 结构化块识别(chart/metric/table),与 html/svg/mermaid 预览互斥。
  const structuredKind = resolveStructuredKind(language);

  const kind = resolvePreviewableKind(language, code);
  const canCopy = Boolean(code.trim());
  const codeBlock = codeEl ? cloneElement(codeEl, { "data-block": "true" }) : null;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

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
      {(canCopy || (canPreview && kind && onPreview)) ? (
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
      ) : null}
      {codeBlock ?? <pre {...rest}>{children}</pre>}
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

  async function handleCopy() {
    const ok = await copyToClipboard(code);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
  }

  return (
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
      </div>
      <div className="overflow-x-auto rounded-lg border border-morning-mist dark:border-deep-space/80 bg-white dark:bg-space-ink p-3">
        {showSource ? (
          <pre className="text-xs leading-relaxed font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre">
            <code>{code}</code>
          </pre>
        ) : (
          <MermaidDiagram id={id} content={code} />
        )}
      </div>
    </div>
  );
}

/**
 * 流式友好的 Markdown 渲染组件(streamdown 封装)。
 *
 * 相比 react-markdown 的优势:
 *   - 流式优化:未闭合的代码块/表格在 isStreaming=true 时优雅解析,不闪烁
 *   - 内置 GFM(表格/任务列表/删除线)+ KaTeX 数学 + Mermaid 图 + Shiki 代码高亮
 *   - 安全:内置 rehype-harden 防 XSS
 *   - 放行 AI 输出的带样式 HTML 块,style 经白名单过滤 + 中性色映射(适配暗色)
 *
 * 用法:
 *   <Markdown content={msg.content} isStreaming={streaming} />
 *
 * 注:Tailwind 类扫描配置见 globals.css 的 @source 指令。
 */
function MarkdownImpl({ content, isStreaming, renderer = "streamdown", className, onPreview }: MarkdownProps) {
  // custom 渲染器:仅在流式结束后启用(流式中 streamdown 更稳)。原样渲染 AI 的 HTML/class。
  const useCustom = renderer === "custom" && !isStreaming;

  if (useCustom) {
    // 按结构化代码块分段:结构化段用受控组件内联渲染,其余段用 parseMarkdown,
    // 使「输出样式」(如纸面杂志)也能展示 chart/metric/table。
    const segments = splitStructuredSegments(content);
    return (
      <div className={clsx("nekusora-md", className)}>
        {segments.map((seg, i) =>
          seg.type === "structured" ? (
            <StructuredInlineView key={i} kind={seg.kind} raw={seg.raw} />
          ) : seg.type === "mermaid" ? (
            <MermaidInlineBlock key={i} code={seg.raw} isStreaming={false} />
          ) : (
            <div key={i} dangerouslySetInnerHTML={{ __html: parseMarkdown(seg.text) }} />
          ),
        )}
      </div>
    );
  }

  const streamdown = (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      allowedTags={ALLOWED_HTML_TAGS}
      components={STREAMDOWN_COMPONENTS}
      controls={MARKDOWN_CONTROLS}
    >
      {content}
    </Streamdown>
  );

  return (
    <div className={clsx("nekusora-md", className)}>
      <MarkdownRenderContext.Provider value={{ onPreview, isStreaming }}>
        {streamdown}
      </MarkdownRenderContext.Provider>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
