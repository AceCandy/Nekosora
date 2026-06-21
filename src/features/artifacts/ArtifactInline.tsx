"use client";
/**
 * Artifact 内嵌入口 —— 在消息流里渲染"有可渲染产物"的折叠按钮。
 * 点击展开预览 / 在面板打开。
 */
import { useState } from "react";
import { Code2, ChevronDown, ChevronRight, PanelRight } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { clsx } from "clsx";
import type { Artifact } from "./ArtifactPanel";

export function ArtifactInline({
  artifacts,
  onOpenPanel,
}: {
  artifacts: Artifact[];
  onOpenPanel: (a: Artifact) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (artifacts.length === 0) return null;

  return (
    <div className="border border-morning-mist dark:border-deep-space/80 rounded-md bg-neutral-50/30 dark:bg-[#0d0f14]/10 overflow-hidden max-w-[75ch]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Code2 className="w-3 h-3" />
        <span>{artifacts.length} 个可渲染产物</span>
        <span className="text-neutral-300 dark:text-neutral-600">·</span>
        <span className="truncate">{artifacts.map((a) => a.title).join(", ")}</span>
      </button>

      {expanded && (
        <div className="border-t border-morning-mist dark:border-deep-space/60 px-3 py-2 space-y-2">
          {artifacts.map((a, i) => (
            <div key={i} className="rounded border border-neutral-200/50 dark:border-neutral-800/50 overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1 bg-neutral-100/50 dark:bg-neutral-900/30">
                <span className="text-[10px] font-mono text-neutral-500">
                  [{a.kind}] {a.title}
                </span>
                <button
                  onClick={() => onOpenPanel(a)}
                  className="inline-flex items-center gap-1 text-[10px] text-sora-blue hover:underline"
                >
                  <PanelRight className="w-3 h-3" />
                  面板打开
                </button>
              </div>
              <SyntaxHighlighter
                language={a.language || "text"}
                style={oneDark}
                customStyle={{ margin: 0, fontSize: "11px", padding: "8px", maxHeight: "120px" }}
              >
                {a.content.slice(0, 500) + (a.content.length > 500 ? "\n…" : "")}
              </SyntaxHighlighter>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { clsx };
