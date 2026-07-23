"use client";

interface PreviewMediaProps {
  url: string;
  mime: string;
  filename: string;
}

/**
 * 媒体预览 —— 图片/音频/视频(原生 HTML 标签,零依赖)。
 *
 * 路由:
 *   - image/* → <img>(支持缩放浏览器原生行为)
 *   - audio/* → <audio controls>
 *   - video/* → <video controls>
 */
export default function PreviewMedia({ url, mime, filename }: PreviewMediaProps) {
  if (mime.startsWith("image/")) {
    return (
      <div className="flex items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-950/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          className="max-w-full max-h-[70vh] object-contain rounded"
        />
      </div>
    );
  }

  if (mime.startsWith("audio/")) {
    return (
      <div className="p-6">
        <audio controls className="w-full" preload="metadata">
          <source src={url} type={mime} />
        </audio>
        <p className="mt-2 text-ui-caption text-center text-neutral-400 truncate">{filename}</p>
      </div>
    );
  }

  if (mime.startsWith("video/")) {
    return (
      <div className="p-4">
        <video controls className="w-full max-h-[70vh] rounded" preload="metadata">
          <source src={url} type={mime} />
        </video>
      </div>
    );
  }

  // 不应到达此处(FilePreview 已按 mime 路由),兜底。
  return null;
}
