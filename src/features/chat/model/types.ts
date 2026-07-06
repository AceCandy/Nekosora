/**
 * chat 域共享类型 —— 被 hooks / components / actions 共用。
 *
 * 从 ChatComposer.tsx 抽离,避免 hooks 之间互相 import 组件文件。
 */
import type { Artifact } from "@/features/artifacts/ArtifactPanel";
import type { ModelCapabilities } from "@/db/types";

/** 单条聊天消息(含可选的追踪/产物元数据)。 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string; // 推理过程(thinking),仅 reasoning 模型产出
  publicId?: string;
  /** 生成状态:interrupted 表示被中途停止(可继续生成);success 表示完整结束。缺省视作完整。 */
  status?: "success" | "interrupted";
  /** 工具调用过程(MCP):按发生顺序记录每次调用及结果。 */
  toolCalls?: ToolCallRecord[];
  /** 联网搜索引用来源。 */
  searchResults?: { title: string; url: string; snippet: string }[];
  /** 版本信息:当前消息的同级兄弟数(>1 时显示切换器)。 */
  versionInfo?: { current: number; total: number };
  trace?: {
    totalTokenEstimate?: number;
    sentTokenEstimate?: number;
    fullMessageCount?: number;
    sentMessageCount?: number;
    blocks?: { kind: string; title?: string; tokenEstimate?: number }[];
  };
  artifacts?: Artifact[]; // 关联的可渲染产物
}

/** 单次工具调用记录:调用时 status="calling",结果返回后更新。 */
export interface ToolCallRecord {
  toolName: string;
  args?: unknown;
  status: "calling" | "done" | "error";
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
  capabilities?: ModelCapabilities;
}

/** 指令卡选项(精简版,供 chat 选择器用)。 */
export interface CardOption {
  id: string;
  trigger: string;
  title: string;
  description?: string | null;
}

/** 知识库选项(供 chat 选择器用)。 */
export interface KnowledgeBaseOption {
  id: string;
  name: string;
  fileCount: number;
}

/** 输出方式选项(管理员预设的会话级输出模式)。 */
export interface OutputModeOption {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
}

/** 输出样式选项(管理员预设的会话级 Markdown 渲染样式)。 */
export interface RenderStyleOption {
  id: string;
  cssClass: string;
  renderer: "streamdown" | "custom";
  name: string;
  description?: string | null;
  icon?: string | null;
}
