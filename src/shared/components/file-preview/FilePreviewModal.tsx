"use client";

import { X } from "lucide-react";
import Modal from "@/shared/ui/Modal";
import FilePreview from "./FilePreview";

export interface PreviewableFile {
  fileId: string;
  filename: string;
  mime: string;
}

interface FilePreviewModalProps {
  file: PreviewableFile | null;
  onClose: () => void;
}

/**
 * 文件预览弹窗 —— 点击附件/产物时弹出全屏预览。
 *
 * 用法:
 *   const [preview, setPreview] = useState<PreviewableFile | null>(null);
 *   <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
 *
 * 复用 shared/ui/Modal 作为容器(自定义宽度和无 padding body),
 * 内部按 mime 路由(FilePreview)。URL 统一为 /api/files/{fileId}(受属主鉴权保护)。
 */
export default function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const isImage = file?.mime.startsWith("image/") ?? false;

  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title={isImage ? undefined : file?.filename}
      ariaLabel={isImage ? file?.filename : undefined}
      dialogClassName={isImage
        ? "m-auto w-fit max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-visible border-0 bg-transparent p-0 text-nebula-silver shadow-none backdrop:bg-black/75"
        : "m-auto w-[min(960px,94vw)] max-h-[92vh] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver"}
      bodyClassName={isImage ? "relative overflow-visible p-0" : "p-0 max-h-[82vh] overflow-hidden"}
    >
      {file && (
        <>
          {isImage && (
            <button
              type="button"
              onClick={onClose}
              className="touch-target fixed right-3 top-3 z-10 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="关闭"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <FilePreview
            url={`/api/files/${file.fileId}`}
            filename={file.filename}
            mime={file.mime}
            className={isImage ? undefined : "h-[82vh]"}
          />
        </>
      )}
    </Modal>
  );
}
