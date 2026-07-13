/**
 * 共享领域类型 —— 由 schema/pg.ts re-export,业务代码统一从 schema 取用。
 * 与具体列类型解耦。
 */

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

/** 输入区数组型会话状态(指令卡 / 知识库),存于 conversations.composerState。 */
export interface ComposerState {
  cardIds?: string[];
  kbIds?: string[];
  /** 当前会话按具体模型保存推理级别;缺省按模型能力选择默认档。 */
  reasoningByModelId?: Record<string, ReasoningLevel>;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface ProcessTraceBlock {
  kind: string;
  title?: string;
  tokenEstimate?: number;
  cacheable?: boolean;
  sourceCount?: number;
}

export interface ProcessTrace {
  mode?: string;
  promptFingerprint?: string;
  totalTokenEstimate?: number;
  sentTokenEstimate?: number;
  fullMessageCount?: number;
  sentMessageCount?: number;
  blocks?: ProcessTraceBlock[];
}

// 枚举字面量类型(pg 用 pgEnum 存储)。
export type ApiKeyKind = "master" | "sub";
export type ProviderProtocol =
  | "openai" | "anthropic" | "gemini" | "openai-compatible"
  // P1-D:非 chat 协议族(图像生成 / 语音转写 / 语音合成,均 OpenAI 兼容格式)
  | "openai-images" | "openai-audio-stt" | "openai-audio-tts";
export type MessageStatus = "pending" | "streaming" | "success" | "interrupted";
/** 错误请求的生命周期阶段(ops_error_logs.errorPhase,双 dialect 均以 text 存储)。 */
export type ErrorPhase =
  | "routing" | "upstream" | "network" | "internal" | "auth" | "request";
