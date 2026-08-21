/**
 * 共享领域类型 —— 由 schema/pg.ts re-export,业务代码统一从 schema 取用。
 * 与具体列类型解耦。
 */

import type { ChatProcessSnapshot, TokenUsage } from "@nekusora/contracts/chat";

export type { TokenUsage } from "@nekusora/contracts/chat";

/** 推理强度档位,与 pi 的完整 ThinkingLevel 对齐。 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/** 含「关闭」:off=不传 reasoning 参数,回归普通对话。 */
export type ReasoningLevel = "off" | ThinkingLevel;
/** per-model 级别→供应商值。null=明确不支持;缺省=使用该格式默认值(xhigh/max 除外)。 */
export type ThinkingLevelMap = Partial<Record<ReasoningLevel, string | null>>;
export type ThinkingFormat =
  | "fixed"
  | "openai"
  | "anthropic"
  | "anthropic-adaptive"
  | "google"
  | "openrouter"
  | "deepseek"
  | "together"
  | "zai"
  | "qwen"
  | "qwen-chat-template"
  | "agnes"
  | "string-thinking"
  | "ant-ling";

/** 模型官方原生联网搜索协议；缺省表示未验证支持。 */
export type WebSearchFormat = "openai" | "anthropic" | "google" | "xai";

export interface ModelCapabilities {
  tools?: boolean;
  vision?: boolean;
  systemPrompt?: boolean;
  reasoning?: boolean;
  /** 兼容接口是否接受独立 reasoning_effort;toggle-only 模型保持 false/缺省。 */
  reasoningEffort?: boolean;
  /** 模型官方思考参数编码;同一目录模型的全部路由共用。 */
  thinkingFormat?: ThinkingFormat;
  /** per-model 推理级别映射;缺省按 protocol 默认。仅 reasoning=true 时有意义。 */
  thinkingLevelMap?: ThinkingLevelMap;
  /** P1-D:图像生成(DALL-E / gpt-image 兼容)。 */
  imageGeneration?: boolean;
  /** P1-D:语音转文字(Whisper 兼容)。 */
  audioTranscription?: boolean;
  /** P1-D:文字转语音(TTS 兼容)。 */
  audioSynthesis?: boolean;
  /** 原生联网搜索请求语义；只能由模型目录显式声明。 */
  webSearchFormat?: WebSearchFormat;
}

export type ModelType = "chat" | "image" | "embedding" | "rerank" | "audio";

export interface ModelDefaultParams {
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  reasoningProfile?: string | null;
}

export interface ContextPolicy {
  maxTurns?: number;
  maxInputTokens?: number;
  compactEnabled?: boolean;
  compactTriggerTokens?: number;
  compactPreserveRecentTurns?: number;
}

/** 输入区会话状态,存于 conversations.composerState。 */
export interface ComposerState {
  cardIds?: string[];
  /** 当前会话按具体模型保存推理级别;缺省按模型能力选择默认档。 */
  reasoningByModelId?: Record<string, ReasoningLevel>;
}

/** 记忆提取任务持久化的最小消息快照。 */
export interface MemoryExtractionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProcessTraceBlock {
  kind: string;
  title?: string;
  tokenEstimate?: number;
  cacheable?: boolean;
  sourceCount?: number;
}

export interface WebSearchTraceCitation {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface WebSearchTraceTimeRange {
  preset: "week" | "month" | "custom";
  startDate: string;
  endDate: string;
}

export interface WebSearchTraceBackend {
  type: "current-model" | "model" | "provider";
  id?: string;
  name: string;
}

export type WebSearchTraceAttemptOutcome =
  | "success"
  | "empty"
  | "unavailable"
  | "skipped_after_timeout"
  | "unsupported"
  | "timeout"
  | "failed";

export interface WebSearchTraceAttempt {
  backend: WebSearchTraceBackend;
  outcome: WebSearchTraceAttemptOutcome;
  durationMs: number;
  timeRange?: WebSearchTraceTimeRange;
}

export type WebSearchAttemptSummary = Pick<WebSearchTraceAttempt, "backend" | "outcome">;

export interface WebSearchTraceCall {
  toolCallId: string;
  query: string;
  requestedTimeRange?: WebSearchTraceTimeRange;
  effectiveTimeRange?: WebSearchTraceTimeRange;
  freshnessFallback?: boolean;
  mode: WebSearchTraceBackend["type"] | null;
  backend: WebSearchTraceBackend | null;
  status: "running" | "success" | "failed" | "unavailable" | "cancelled";
  reason?: string;
  durationMs?: number;
  citations?: WebSearchTraceCitation[];
  attempts?: WebSearchTraceAttempt[];
}

export interface ProcessTrace {
  mode?: string;
  promptFingerprint?: string;
  totalTokenEstimate?: number;
  sentTokenEstimate?: number;
  fullMessageCount?: number;
  sentMessageCount?: number;
  blocks?: ProcessTraceBlock[];
  webSearch?: { calls: WebSearchTraceCall[] };
  process?: ChatProcessSnapshot;
}

/** 分享创建时冻结的单条消息正文。 */
export interface ConversationShareMessageSnapshot {
  publicId: string;
  role: string;
  content: unknown;
  /** 消息绝对创建时间；旧分享快照可能缺失。 */
  createdAt?: string;
  /** assistant 回复实际使用的模型；旧分享快照可能缺失。 */
  model?: string;
  /** assistant 回复的 token 用量；旧分享快照可能缺失。 */
  tokenUsage?: TokenUsage;
  /** assistant 回复从请求到完成的总耗时；旧分享快照可能缺失。 */
  durationMs?: number;
}

/** 新版对话分享模式；null 仅用于识别历史分享。 */
export type ConversationShareMode = "snapshot" | "live";

/** 快照分享冻结的完整输出样式语义。 */
export interface ConversationShareRenderStyleSnapshot {
  sourceId: string | null;
  name: string;
  cssClass: string;
  css: string;
  renderer: "streamdown" | "custom";
}

/** 会话中每个 assistant 兄弟组当前选中的消息版本。key 为 parent message id。 */
export type MessageVersionSelections = Record<string, string>;

// 枚举字面量类型(pg 用 pgEnum 存储)。
export type ApiKeyKind = "master" | "sub";
export type ProviderProtocol =
  | "openai" | "anthropic" | "gemini" | "openai-compatible"
  // P1-D:非 chat 协议族(图像生成 / 语音转写 / 语音合成,均 OpenAI 兼容格式)
  | "openai-images" | "openai-audio-stt" | "openai-audio-tts";
export const ROUTE_API_FORMATS = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
  "openai-images",
  "openai-audio-stt",
  "openai-audio-tts",
] as const;
export type RouteApiFormat = (typeof ROUTE_API_FORMATS)[number];

/** Provider 的连接类型只用于给新 route 选择兼容的默认 wire format。 */
export function defaultRouteApiFormat(protocol: ProviderProtocol): RouteApiFormat {
  switch (protocol) {
    case "openai":
    case "openai-compatible":
      return "openai-chat";
    case "anthropic":
      return "anthropic-messages";
    case "gemini":
      return "gemini-generate-content";
    default:
      return protocol;
  }
}

export function isChatRouteApiFormat(format: RouteApiFormat): boolean {
  return format === "openai-chat"
    || format === "openai-responses"
    || format === "anthropic-messages"
    || format === "gemini-generate-content";
}

/** 校验 route wire format 与模型类型相容；空值使用 Provider 的兼容默认格式。 */
export function routeApiFormatForModel(
  value: string | null | undefined,
  protocol: ProviderProtocol,
  modelType: ModelType,
): RouteApiFormat {
  const format = value || defaultRouteApiFormat(protocol);
  if (!(ROUTE_API_FORMATS as readonly string[]).includes(format)) {
    throw new Error("不支持的上游 API 格式");
  }
  if (modelType === "chat" ? !isChatRouteApiFormat(format as RouteApiFormat) : format !== defaultRouteApiFormat(protocol)) {
    throw new Error("上游 API 格式与模型类型不匹配");
  }
  return format as RouteApiFormat;
}
export type MessageStatus = "pending" | "streaming" | "success" | "interrupted";
/** 网关执行错误的生命周期阶段(gateway_executions.errorPhase，以 text 存储)。 */
export type ErrorPhase =
  | "routing" | "upstream" | "network" | "internal" | "auth" | "request";
