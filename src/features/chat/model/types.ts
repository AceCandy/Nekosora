/**
 * chat 域共享类型 —— 被 hooks / components / actions 共用。
 *
 * 从 ChatComposer.tsx 抽离,避免 hooks 之间互相 import 组件文件。
 */
import type { Artifact } from "@/features/artifacts/ArtifactPanel";
import type {
  ModelCapabilities,
  TokenUsage,
  WebSearchTraceBackend,
  WebSearchTraceCitation,
} from "@/db/types";
import type { MessageFeedback } from "@/features/chat/model/feedback";

export type { FeedbackReason, FeedbackRating, MessageFeedback } from "@/features/chat/model/feedback";

/** assistant 消息对应的可序列化 run 投影。 */
export interface MessageRunMetadata {
  model?: string;
  tokenUsage?: TokenUsage;
  durationMs?: number;
  completedAt?: string;
}

/** 用户消息中可持久恢复的图片附件；展示 URL 在读取时按 fileId 生成。 */
export interface ChatMessageAttachment {
  fileId: string;
  filename: string;
  mime: string;
}

/** 单条聊天消息(含可选的运行与产物元数据)。 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatMessageAttachment[];
  /** 消息绝对创建时间的 ISO 字符串，仅用于本地化展示。 */
  createdAt?: string;
  reasoning?: string; // 推理过程(thinking),仅 reasoning 模型产出
  publicId?: string;
  /** 生成状态:interrupted 表示被中途停止(可继续生成);success 表示完整结束。缺省视作完整。 */
  status?: "success" | "interrupted";
  /** 工具调用过程:按发生顺序记录每次调用及结果。 */
  toolCalls?: ToolCallRecord[];
  /** 联网搜索引用来源。 */
  searchResults?: WebSearchTraceCitation[];
  /** 实际完成搜索的后端，按搜索调用去重。 */
  searchBackends?: WebSearchTraceBackend[];
  /** 版本信息:当前消息的同级兄弟数(>1 时显示切换器)。 */
  versionInfo?: { current: number; total: number };
  /** 当前用户对该 assistant 回复的质量反馈(无记录时缺省)。 */
  feedback?: MessageFeedback;
  /** 该 assistant 回复对应的 run 元数据。 */
  runMetadata?: MessageRunMetadata;
  artifacts?: Artifact[]; // 关联的可渲染产物
}

/** 单次工具调用记录:调用时 status="calling",结果返回后更新。 */
export interface ToolCallRecord {
  /** 新记录使用稳定调用 ID；旧历史记录可能缺失。 */
  toolCallId?: string;
  toolName: string;
  args?: unknown;
  status: "calling" | "done" | "error";
}

/** 附件上传项的状态机。 */
export interface UploadFileItem {
  id: string;
  fileId?: string;
  filename: string;
  mime?: string;
  file?: File;
  status: "pending" | "uploading" | "uploaded" | "error";
  progress?: number;
  isImage?: boolean;
  previewUrl?: string; // 本地预览(URL.createObjectURL),仅图片
}

/** 模型选项:modelId 是选项唯一 id(用于 byId 路由解析),name 是对外模型名,displayName 是 UI 渲染名。 */
export interface ModelOption {
  /** 模型 id(选项唯一标识,WebChat 发消息以此走 resolveRoutesById,避免 public/private 同名歧义)。 */
  modelId: string;
  name: string;
  displayName?: string;
  capabilities?: ModelCapabilities;
  /** 模型来源:语义基于 visibility(public→"global"、private→"byo"),供 UI 显示小标签。 */
  source?: "global" | "byo";
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

/** 输出模式选项(管理员预设的会话级输出模式)。 */
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
