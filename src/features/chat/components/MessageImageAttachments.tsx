"use client";

import { useState } from "react";
import { ImageOff, X } from "lucide-react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import type { ChatMessageAttachment } from "@/features/chat/model/types";
import FilePreviewModal, {
  type PreviewableFile,
} from "@/shared/components/file-preview/FilePreviewModal";

interface MessageImageAttachmentsProps {
  attachments: ChatMessageAttachment[];
  onRemove?: (fileId: string) => void;
}

/** 用户消息图片组；点击统一进入现有无边框文件查看器。 */
export function MessageImageAttachments({
  attachments,
  onRemove,
}: MessageImageAttachmentsProps) {
  const t = useTranslations("chat");
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<PreviewableFile | null>(null);
  if (attachments.length === 0) return null;

  const single = attachments.length === 1;
  return (
    <>
      <div className={clsx("grid w-full gap-1.5", single ? "grid-cols-1" : "grid-cols-2")}>
        {attachments.map((attachment) => {
          const failed = failedIds.has(attachment.fileId);
          return (
            <div
              key={attachment.fileId}
              className={clsx(
                "group/image relative min-w-0 overflow-hidden rounded-lg bg-black/5 dark:bg-white/5",
                single ? "aspect-[4/3] max-h-80" : "aspect-square",
              )}
            >
              <button
                type="button"
                onClick={() => setPreview(attachment)}
                className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue"
                aria-label={`${t("attachPreview")}: ${attachment.filename}`}
              >
                {failed ? (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-3 text-center text-ui-caption text-neutral-500 dark:text-neutral-400">
                    <ImageOff className="h-5 w-5" aria-hidden="true" />
                    <span>{t("attachmentLoadFailed")}</span>
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${attachment.fileId}`}
                    alt={attachment.filename}
                    className="block h-full w-full object-cover"
                    loading="lazy"
                    onError={() => {
                      setFailedIds((current) => new Set(current).add(attachment.fileId));
                    }}
                  />
                )}
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(attachment.fileId)}
                  className="touch-target absolute right-1 top-1 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  title={t("attachRemove")}
                  aria-label={`${t("attachRemove")}: ${attachment.filename}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
    </>
  );
}
