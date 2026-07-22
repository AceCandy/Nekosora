"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle } from "lucide-react";

interface PreviewTextProps {
  url: string;
  filename: string;
  mime?: string;
}

const MAX_TEXT_BYTES = 512 * 1024; // 512KB:超大文本只读前 512KB,避免卡死

/**
 * 文本/代码预览 —— fetch 内容后以等宽字体渲染。
 *
 * 支持:text/*、application/json、application/xml、
 *       常见代码扩展(.js/.ts/.py/.go/.rs/.md/.yaml...)。
 *
 * 超过 MAX_TEXT_BYTES 截断并提示。无语法高亮(流式 markdown 已有 streamdown,
 * 此处保持轻量;如需高亮可后续接入)。
 */
export default function PreviewText({ url, filename, mime }: PreviewTextProps) {
  const t = useTranslations("filePreview");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent(null);
    setError(null);
    setTruncated(false);

    // 多取 1 字节判断是否截断;API/S3 Range 避免先下载完整文件。
    fetch(url, { headers: { Range: `bytes=0-${MAX_TEXT_BYTES}` } })
      .then(async (res) => {
        if (res.status === 416) {
          if (!cancelled) setContent("");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const isTruncated = buf.byteLength > MAX_TEXT_BYTES;
        const preview = isTruncated ? buf.slice(0, MAX_TEXT_BYTES) : buf;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(preview);
        if (!cancelled) {
          setTruncated(isTruncated);
          setContent(text);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadingFailed"));
      });

    return () => {
      cancelled = true;
    };
  }, [url, t]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-neutral-400">
        <AlertCircle className="w-8 h-8" />
        <p className="text-xs">{t("loadingFailed")}:{error}</p>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex items-center justify-center p-8 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
        <span className="text-[11px] font-mono text-neutral-500 truncate">{filename}</span>
        {mime && (
          <span className="text-[10px] font-mono text-neutral-400">{mime}</span>
        )}
      </div>
      <pre className="flex-1 overflow-auto p-3 text-[11px] font-mono leading-relaxed text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words">
        <code>{content}</code>
      </pre>
      {truncated && (
        <div className="px-3 py-1.5 border-t border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-[10px] text-amber-600 dark:text-amber-400">
          {t("fileTooLarge", { kb: Math.round(MAX_TEXT_BYTES / 1024) })}
        </div>
      )}
    </div>
  );
}
