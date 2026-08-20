"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { Check, CircleAlert, Copy, Download, ImageOff, ZoomIn } from "lucide-react";
import ImagePreviewModal from "@/shared/components/file-preview/ImagePreviewModal";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { getProxiedMarkdownImageUrl } from "./linkPreview";

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & { node?: unknown };

interface MarkdownImagePreviewModalProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt?: string;
  title?: string;
}

function ImageCopyLinkButton({ src, className }: { src: string; className?: string }) {
  const t = useTranslations("artifacts");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const label = copyState === "copied"
    ? t("imageLinkCopied")
    : copyState === "failed"
      ? t("imageCopyFailed")
      : t("imageCopyLink");

  const handleCopy = async () => {
    const copied = await copyToClipboard(src);
    setCopyState(copied ? "copied" : "failed");
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1400);
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      className={className}
      title={label}
      aria-label={label}
    >
      {copyState === "copied" ? (
        <Check className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
      ) : copyState === "failed" ? (
        <CircleAlert className="w-3.5 h-3.5 text-danger" aria-hidden="true" />
      ) : (
        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/** Streamdown 与 custom 渲染器共用的图片大图预览。 */
export function MarkdownImagePreviewModal({
  open,
  onClose,
  src,
  alt,
  title,
}: MarkdownImagePreviewModalProps) {
  const t = useTranslations("artifacts");
  const imageUrl = getProxiedMarkdownImageUrl(src);

  return (
    <ImagePreviewModal
      open={open}
      onClose={onClose}
      src={imageUrl}
      alt={alt ?? ""}
      ariaLabel={title || alt || t("imageZoom")}
      toolbar={(
        <>
          <ImageCopyLinkButton
            src={src}
            className="touch-target inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
          />
          <a
            href={imageUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="touch-target inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
            title={t("imageDownload")}
            aria-label={t("imageDownload")}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </a>
        </>
      )}
    />
  );
}

/**
 * Markdown 图片(streamdown components.img 自定义):
 * 加载中骨架 / 失败占位 / hover 浮窗(放大+下载)/ 点击 Modal 放大查看。
 * 对齐 DEEIX 图片富交互:rounded-xl + Dialog 放大 + 加载/失败占位。
 */
export function MarkdownImage({
  src,
  alt,
  title,
  node: _node,
  className,
  onClick,
  onKeyDown,
  ...rest
}: MarkdownImageProps) {
  const t = useTranslations("artifacts");
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [zoomOpen, setZoomOpen] = useState(false);

  // 无 src(罕见):退化为失败占位,避免渲染空 img。
  if (!src) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-morning-mist  bg-neutral-50  px-2 py-1 text-ui-caption text-neutral-500">
        <ImageOff className="w-3.5 h-3.5" aria-hidden="true" />
        {alt || t("imageFailed")}
      </span>
    );
  }
  const imageUrl = typeof src === "string" ? getProxiedMarkdownImageUrl(src) : src;
  const originalUrl = String(src);

  return (
    <>
      <span className="group relative my-2 inline-block max-w-full min-h-[100px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          {...rest}
          src={imageUrl}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented) setZoomOpen(true);
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            setZoomOpen(true);
          }}
          role="button"
          tabIndex={0}
          aria-label={alt || t("imageZoom")}
          className={clsx(
            "block max-w-full rounded-xl border border-morning-mist  cursor-zoom-in transition-opacity",
            status === "loaded" ? "opacity-100" : "opacity-0",
            className,
          )}
        />
        {status === "loading" && (
          <span className="absolute inset-0 rounded-xl bg-neutral-100  animate-pulse" aria-hidden="true" />
        )}
        {status === "error" && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl border border-morning-mist  bg-neutral-50  p-3 text-center text-ui-caption text-neutral-500">
            <ImageOff className="w-5 h-5" aria-hidden="true" />
            <span className="line-clamp-2">{alt || t("imageFailed")}</span>
          </span>
        )}
        {status === "loaded" && (
          <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-white border border-morning-mist px-1 py-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800    focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
              title={t("imageZoom")}
              aria-label={t("imageZoom")}
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <ImageCopyLinkButton
              src={originalUrl}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800    focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
            />
            <a
              href={String(imageUrl)}
              download
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-950/5 hover:text-neutral-800    focus-visible:outline focus-visible:ring-2 focus-visible:ring-sora-blue cursor-pointer"
              title={t("imageDownload")}
              aria-label={t("imageDownload")}
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </span>
        )}
      </span>
      <MarkdownImagePreviewModal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        src={originalUrl}
        alt={alt}
        title={title || alt || undefined}
      />
    </>
  );
}
