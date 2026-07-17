"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { ZoomIn, Download, ImageOff } from "lucide-react";
import Modal from "@/shared/ui/Modal";

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

/**
 * Markdown 图片(streamdown components.img 自定义):
 * 加载中骨架 / 失败占位 / hover 浮窗(放大+下载)/ 点击 Modal 放大查看。
 * 对齐 DEEIX 图片富交互:rounded-xl + Dialog 放大 + 加载/失败占位。
 */
export function MarkdownImage({ src, alt, title, node: _node, ...rest }: MarkdownImageProps) {
  const t = useTranslations("artifacts");
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [zoomOpen, setZoomOpen] = useState(false);

  // 无 src(罕见):退化为失败占位,避免渲染空 img。
  if (!src) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-morning-mist dark:border-deep-space/80 bg-neutral-50 dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-500">
        <ImageOff className="w-3.5 h-3.5" aria-hidden="true" />
        {alt || t("imageFailed")}
      </span>
    );
  }

  return (
    <>
      <figure className="group relative my-2 inline-block max-w-full min-h-[100px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          onClick={() => setZoomOpen(true)}
          className={clsx(
            "block max-w-full rounded-xl border border-morning-mist dark:border-deep-space/80 cursor-zoom-in transition-opacity",
            status === "loaded" ? "opacity-100" : "opacity-0",
          )}
          {...rest}
        />
        {status === "loading" && (
          <div className="absolute inset-0 rounded-xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" aria-hidden="true" />
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl border border-morning-mist dark:border-deep-space/80 bg-neutral-50 dark:bg-neutral-900 p-3 text-center text-xs text-neutral-500">
            <ImageOff className="w-5 h-5" aria-hidden="true" />
            <span className="line-clamp-2">{alt || t("imageFailed")}</span>
          </div>
        )}
        {status === "loaded" && (
          <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-space-ink/80 px-1 py-1 backdrop-blur-sm opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
              title={t("imageZoom")}
              aria-label={t("imageZoom")}
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <a
              href={String(src)}
              download
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
              title={t("imageDownload")}
              aria-label={t("imageDownload")}
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>
        )}
      </figure>
      <Modal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={title || alt || undefined}
        dialogClassName="m-auto w-[min(1100px,94vw)] max-h-[92vh] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/50 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver"
        bodyClassName="p-0 max-h-[82vh] overflow-hidden flex items-center justify-center"
      >
        {zoomOpen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt ?? ""} className="max-h-[82vh] max-w-full object-contain" />
        )}
      </Modal>
    </>
  );
}
