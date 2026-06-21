/**
 * chat 域共享类型 —— 被 hooks / components / actions 共用。
 *
 * 从 ChatComposer.tsx 抽离,避免 hooks 之间互相 import 组件文件。
 */
import type { Artifact } from "@/features/artifacts/ArtifactPanel";

/** 单条聊天消息(含可选的追踪/产物元数据)。 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  publicId?: string;
  trace?: {
    totalTokenEstimate?: number;
    sentMessageCount?: number;
    blocks?: { kind: string; title?: string; tokenEstimate?: number }[];
  };
  artifacts?: Artifact[]; // 关联的可渲染产物
}

/** 附件上传项的状态机。 */
export interface UploadFileItem {
  id: string;
  fileId?: string;
  filename: string;
  file?: File;
  status: "pending" | "uploading" | "uploaded" | "error";
  progress?: number;
  isImage?: boolean;
  previewUrl?: string; // 本地预览(URL.createObjectURL),仅图片
}

/** 模型选项:name 是对外稳定 ID,displayName 是 UI 渲染名。 */
export interface ModelOption {
  name: string;
  displayName?: string;
}

/** 指令卡选项(精简版,供 chat 选择器用)。 */
export interface CardOption {
  id: string;
  trigger: string;
  title: string;
  description?: string | null;
}
