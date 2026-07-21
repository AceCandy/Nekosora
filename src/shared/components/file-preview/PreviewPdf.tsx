"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle } from "lucide-react";

interface PreviewPdfProps {
  url: string;
  filename: string;
}

/**
 * PDF 预览 —— 基于 pdfjs-dist,逐页 canvas 渲染。
 *
 * 关键配置(中文 PDF 必备):
 *   - workerSrc:用 pdfjs 自带 worker(从 node_modules 解析,Next 会打包)
 *   - cmapsUrl:加载 /public/pdfjs/cmaps(CJK 字符映射,否则中文显方块)
 *   - standardFontDataUrl:加载 /public/pdfjs/standard_fonts(14 种标准字体)
 *
 * 这三组资源由 scripts/sync-pdfjs-assets.cjs 在 postinstall 时从 pdfjs-dist 同步。
 *
 * 渲染策略:依次渲染所有页(懒加载优化留作后续),canvas 输出避免字体差异。
 */
export default function PreviewPdf({ url, filename }: PreviewPdfProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const t = useTranslations("filePreview");

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<unknown> } | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 动态 import,避免 pdfjs 在 SSR 阶段执行(它依赖 DOM/worker)。
        const pdfjs = await import("pdfjs-dist");

        // worker 由 postinstall 同步到 public/pdfjs,与 cmaps/fonts 一样同源加载。
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        }

        const loadingTask = pdfjs.getDocument({
          url,
          // 中文/CJK 支持的关键:cmaps 与 standard fonts。
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });

        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        // 依次渲染每一页到独立 canvas。
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.maxWidth = `${viewport.width}px`;
          canvas.style.height = "auto";
          canvas.style.margin = "0 auto 12px";
          canvas.style.display = "block";
          canvas.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
          container.appendChild(canvas);

          renderTask = page.render({ canvasContext: ctx, viewport, canvas });
          await renderTask.promise;
          setCurrentPage(i);
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("loadingFailed"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask?.promise) renderTask.promise.catch(() => undefined);
    };
  }, [url, t]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-neutral-400">
        <AlertCircle className="w-8 h-8" />
        <p className="text-xs">{t("loadingFailed")}:{error}</p>
        <a href={url} download={filename} className="text-xs text-sora-blue underline">
          {t("downloadFile")}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 shrink-0">
        <span className="text-[11px] font-mono text-neutral-500 truncate">{filename}</span>
        <span className="text-[10px] font-mono text-neutral-400">
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {currentPage}/{pageCount || "?"}
            </span>
          ) : (
            t("pageCount", { count: pageCount })
          )}
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950 p-4">
        <div ref={containerRef} />
        {loading && (
          <div className="flex items-center justify-center py-12 text-neutral-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
