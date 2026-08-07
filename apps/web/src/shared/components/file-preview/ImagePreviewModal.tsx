"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import Modal from "@/shared/ui/Modal";

interface ImagePreviewModalProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt: string;
  ariaLabel?: string;
  toolbar?: ReactNode;
}

/** 图片专用 lightbox；附件和 Markdown 图片共用同一视觉与关闭行为。 */
export default function ImagePreviewModal({
  open,
  onClose,
  src,
  alt,
  ariaLabel,
  toolbar,
}: ImagePreviewModalProps) {
  const t = useTranslations("common");
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <Modal
      open
      onClose={onClose}
      ariaLabel={ariaLabel || alt}
      dialogClassName="m-auto w-fit max-h-[96dvh] max-w-[96vw] overflow-visible border-0 bg-transparent p-0 text-nebula-silver shadow-none backdrop:bg-black/75"
      bodyClassName="relative flex items-center justify-center overflow-visible p-0"
    >
      <button
        type="button"
        onClick={onClose}
        className="touch-target fixed right-3 top-3 z-10 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label={t("close")}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block max-h-[92dvh] max-w-[96vw] object-contain" />
      {toolbar && (
        <div
          role="toolbar"
          className="fixed bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 p-1 text-white"
        >
          {toolbar}
        </div>
      )}
    </Modal>,
    document.body,
  );
}
