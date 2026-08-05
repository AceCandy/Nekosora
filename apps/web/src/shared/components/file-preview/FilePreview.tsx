"use client";

import { useTranslations } from "next-intl";
import UnsupportedFile from "./UnsupportedFile";
import PreviewMedia from "./PreviewMedia";
import PreviewText from "./PreviewText";
import PreviewPdf from "./PreviewPdf";

export interface FilePreviewProps {
  /** 文件可访问 URL(通常是 /api/files/{fileId})。 */
  url: string;
  filename: string;
  mime: string;
  className?: string;
}

// 按扩展名判断代码/文本(部分 mime 为 application/octet-stream 的代码文件)。
const CODE_EXTENSIONS = [
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".h", ".cpp", ".hpp", ".cs",
  ".php", ".sh", ".bash", ".zsh", ".fish",
  ".yaml", ".yml", ".toml", ".ini", ".conf", ".env",
  ".sql", ".graphql", ".gql",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".vue", ".svelte",
  ".dockerfile", ".makefile", ".gitignore",
];
const TEXT_EXTENSIONS = [".txt", ".log", ".csv", ".tsv", ".md", ".markdown", ".rst"];

function isTextLike(filename: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-yaml" ||
    mime === "application/x-sh"
  ) {
    return true;
  }
  const lower = filename.toLowerCase();
  return [...CODE_EXTENSIONS, ...TEXT_EXTENSIONS].some((ext) => lower.endsWith(ext));
}

/**
 * 文件预览统一入口 —— 按 mime/扩展名路由到具体预览器。
 *
 * 路由优先级:
 *   1. application/pdf           → PreviewPdf
 *   2. image/* / audio/* / video/* → PreviewMedia
 *   3. 文本/代码类                 → PreviewText
 *   4. 其余(docx/xlsx/ppt 等)   → UnsupportedFile(提供下载)
 *
 * 这是无业务语义的通用组件,放 shared。业务侧(chat/artifacts/files)
 * 只需 <FilePreview url={...} filename={...} mime={...} />。
 */
export default function FilePreview({ url, filename, mime, className }: FilePreviewProps) {
  const t = useTranslations("filePreview");
  let body: React.ReactNode;

  if (mime === "application/pdf") {
    body = <PreviewPdf url={url} filename={filename} />;
  } else if (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/")
  ) {
    body = <PreviewMedia url={url} mime={mime} filename={filename} />;
  } else if (isTextLike(filename, mime)) {
    body = <PreviewText url={url} filename={filename} mime={mime} />;
  } else {
    body = (
      <UnsupportedFile
        url={url}
        filename={filename}
        mime={mime}
        reason={t("unsupportedReason")}
      />
    );
  }

  return <div className={className}>{body}</div>;
}
