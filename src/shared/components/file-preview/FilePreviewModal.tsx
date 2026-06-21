"use client";

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
  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title={file?.filename}
      dialogClassName="m-auto w-[min(960px,94vw)] max-h-[92vh] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver"
      bodyClassName="p-0 max-h-[82vh] overflow-hidden"
    >
      {file && (
        <FilePreview
          url={`/api/files/${file.fileId}`}
          filename={file.filename}
          mime={file.mime}
          className="h-[82vh]"
        />
      )}
    </Modal>
  );
}
