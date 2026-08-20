"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { prism as prismStyle } from "react-syntax-highlighter/dist/esm/styles/prism";
import { X, Copy, Download, Check } from "lucide-react";
import { clsx } from "clsx";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";
import { MermaidDiagram } from "@/shared/components/mermaid/MermaidDiagram";
import { copyToClipboard } from "@/shared/lib/clipboard";

export interface Artifact {
  id: string;
  kind: "code" | "mermaid" | "svg" | "html" | "katex" | "markdown";
  title: string;
  language: string | null;
  content: string;
}

// 动态载入 SyntaxHighlighter Prism，避免 1.2MB 臃肿的解析包打入首屏
const SyntaxHighlighter = dynamic(
  () => import("react-syntax-highlighter").then((mod) => mod.Prism),
  {
    ssr: false,
    loading: () => <pre className="text-ui-caption p-4 animate-pulse text-ink-tertiary font-mono">Loading code highlighter...</pre>,
  }
);

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

  const handleCopy = useCallback(async () => {
    if (!(await copyToClipboard(artifact.content))) return;
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
    <div className={clsx("flex flex-col h-full bg-nebula-white ", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-morning-mist  shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-ui-caption font-mono text-ink-tertiary  shrink-0">
            {artifact.kind}
          </span>
          <span className="text-ui-caption font-medium text-neutral-700  truncate" title={artifact.title}>
            {artifact.title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-neutral-100  text-ink-tertiary hover:text-neutral-600  transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
            title={t("copy")}
            aria-label={t("copy")}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded hover:bg-neutral-100  text-ink-tertiary hover:text-neutral-600  transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
            title={t("download")}
            aria-label={t("download")}
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-neutral-100  text-ink-tertiary hover:text-neutral-600  transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
            title={t("closePanel")}
            aria-label={t("closePanel")}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {artifact.kind === "mermaid" ? (
          <MermaidDiagram id={artifact.id} content={artifact.content} />
        ) : artifact.kind === "svg" || artifact.kind === "html" ? (
          <HtmlPreviewFrame html={artifact.content} />
        ) : (
          <SyntaxHighlighter
            language={artifact.language || "text"}
            style={prismStyle}
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
