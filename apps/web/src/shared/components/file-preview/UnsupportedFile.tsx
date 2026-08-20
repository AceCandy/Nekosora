"use client";

import { useTranslations } from "next-intl";
import { Download, FileWarning } from "lucide-react";

interface UnsupportedFileProps {
  url: string;
  filename: string;
  mime?: string;
  reason?: string; // 为什么不支持(如 "DOCX 预览尚未实现")
}

/**
 * 不支持预览的文件回退 —— 显示文件信息 + 下载按钮。
 *
 * 用于:DOCX/Sheet/PPT 等需重型解析库的格式(暂未实现预览)、
 *       二进制/未知格式。提供下载是最低可用保证。
 */
export default function UnsupportedFile({
  url,
  filename,
  mime,
  reason,
}: UnsupportedFileProps) {
  const t = useTranslations("filePreview");
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <FileWarning className="w-10 h-10 text-neutral-300 " />
      <div className="space-y-1">
        <p className="text-ui-body font-semibold text-neutral-700  break-all">
          {filename}
        </p>
        {reason && (
          <p className="text-ui-caption text-neutral-400 ">{reason}</p>
        )}
        {mime && (
          <p className="text-ui-caption font-mono text-neutral-400 ">
            {mime}
          </p>
        )}
      </div>
      <a
        href={url}
        download={filename}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200  hover:bg-neutral-50  px-3 py-1.5 text-ui-caption font-semibold text-neutral-600  transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{t("downloadFile")}</span>
      </a>
    </div>
  );
}
