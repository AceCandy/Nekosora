"use client";

import { useTranslations } from "next-intl";
/**
 * Artifact 面板 —— P1-B。
 *
 * Mermaid 用动态 import(避免 1.2MB 进首屏 bundle)。
 */
import { useState, useEffect, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { X, Copy, Download, Check } from "lucide-react";
import { clsx } from "clsx";

export interface Artifact {
  id: string;
  kind: "code" | "mermaid" | "svg" | "html" | "katex" | "markdown";
  title: string;
  language: string | null;
  content: string;
}

/** Mermaid 图表渲染(独立组件,隔离动态 import + 异步 state)。 */
function MermaidDiagram({ id, content }: { id: string; content: string }) {
  const t = useTranslations("artifacts");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral" });
        const { svg: rendered } = await mermaid.render(`m-${id}`, content);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "render_failed");
      }
    })();
    return () => { cancelled = true; };
  }, [id, content]);

  if (error) return <div className="text-xs text-neutral-400 p-3">{t("mermaidFailed")} {error}</div>;
  if (!svg) return <div className="text-xs text-neutral-400 animate-pulse">{t("rendering")}</div>;
  return <div className="flex items-center justify-center min-h-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ArtifactPanel({
  artifact,
  onClose,
  className,
}: {
  artifact: Artifact;
  onClose: () => void;
  className?: string;
}) {
  const t = useTranslations("artifacts");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [artifact.content]);

  const handleDownload = useCallback(() => {
    const ext = artifact.language || artifact.kind || "txt";
    const blob = new Blob([artifact.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact]);

  return (
    <div className={clsx("flex flex-col h-full bg-[#fcfdff] dark:bg-[#0d0f14]", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-morning-mist dark:border-deep-space/80 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 dark:text-neutral-500 shrink-0">
            {artifact.kind}
          </span>
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200 truncate" title={artifact.title}>
            {artifact.title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            title={t("copy")}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            title={t("download")}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            title={t("closePanel")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {artifact.kind === "mermaid" ? (
          <MermaidDiagram id={artifact.id} content={artifact.content} />
        ) : artifact.kind === "svg" ? (
          <div className="flex items-center justify-center min-h-full" dangerouslySetInnerHTML={{ __html: artifact.content }} />
        ) : (
          <SyntaxHighlighter
            language={artifact.language || "text"}
            style={oneDark}
            customStyle={{
              margin: 0,
              background: "transparent",
              fontSize: "12px",
              padding: 0,
            }}
            wrapLongLines
          >
            {artifact.content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
