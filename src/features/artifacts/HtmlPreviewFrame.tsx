"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, PanelRight } from "lucide-react";
import {
  buildHtmlPreviewDoc,
  isPreviewResizeMessage,
  HTML_PREVIEW_SANDBOX,
  MIN_PREVIEW_HEIGHT,
  DEFAULT_PREVIEW_HEIGHT,
} from "./html-preview";

interface HtmlPreviewFrameProps {
  html: string;
  /** 可选标题(显示在顶栏)。不传则不显示顶栏。 */
  title?: string;
  /** 可选:打开右侧大面板查看。不传则不显示该按钮。 */
  onOpenPanel?: () => void;
  /** 外层最大宽度类名(内联场景可限制宽度)。 */
  className?: string;
}

/**
 * HTML Artifact 预览 —— iframe srcDoc + sandbox + 高度自适应。
 *
 * 高度自适应:iframe 内 bridge 脚本通过 postMessage 上报内容高度,
 * 父组件据此设 iframe 高度,但不超过父视口 75%(超出则 iframe 内部滚动)。
 * 上限用于截断正反馈循环:html 内容使用 vh / 百分比高度或动态 append 时,
 * 「上报高度 → iframe 变高 → 内容更高 → 再上报」会无限撑高页面。
 */
/** 预览框最大高度:父视口 75%,超出由 iframe 内部滚动。 */
const MAX_PREVIEW_HEIGHT =
  typeof window !== "undefined" ? Math.max(MIN_PREVIEW_HEIGHT, Math.floor(window.innerHeight * 0.75)) : 640;

export function HtmlPreviewFrame({ html, title, onOpenPanel, className }: HtmlPreviewFrameProps) {
  const t = useTranslations("artifacts");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(DEFAULT_PREVIEW_HEIGHT);
  const srcDoc = buildHtmlPreviewDoc(html);

  // 监听 iframe 上报的高度消息
  const handleMessage = useCallback((e: MessageEvent) => {
    if (!isPreviewResizeMessage(e.data)) return;
    const next = Math.min(MAX_PREVIEW_HEIGHT, Math.max(MIN_PREVIEW_HEIGHT, Math.ceil(e.data.height)));
    setHeight(next);
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // 新窗口打开:把 srcdoc 写入 blob URL
  const handleOpenExternal = useCallback(() => {
    const blob = new Blob([srcDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, [srcDoc]);

  const hasHeader = Boolean(title);

  return (
    <div
      className={
        "rounded-md border border-morning-mist dark:border-deep-space/80 overflow-hidden bg-white " +
        (className ?? "")
      }
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-morning-mist dark:border-deep-space/60 bg-neutral-50/50 dark:bg-[#0d0f14]/20">
          <span className="text-[11px] font-mono text-neutral-400 truncate">{title}</span>
          <div className="flex items-center gap-1 shrink-0">
            {onOpenPanel && (
              <button
                type="button"
                onClick={onOpenPanel}
                className="p-1 rounded text-neutral-400 hover:text-sora-blue hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors cursor-pointer"
                title={t("openPanel")}
                aria-label={t("openPanel")}
              >
                <PanelRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenExternal}
              className="p-1 rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors cursor-pointer"
              title={t("openExternal")}
              aria-label={t("openExternal")}
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <div className="relative w-full" style={{ height }}>
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          title={title ?? t("htmlPreview")}
          sandbox={HTML_PREVIEW_SANDBOX}
          className="w-full h-full border-0 bg-white"
          loading="lazy"
        />
        {!hasHeader && (
          <button
            type="button"
            onClick={handleOpenExternal}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-black/30 text-white opacity-0 hover:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
            title={t("openExternal")}
            aria-label={t("openExternal")}
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
