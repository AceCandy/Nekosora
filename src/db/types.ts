/**
 * 共享领域类型 —— dialect 中立,供 pg.ts / sqlite.ts 同步 re-export,
 * 业务代码统一从 schema 取用。与具体列类型解耦。
 */

export interface ModelCapabilities {
  stream?: boolean;
  tools?: boolean;
  vision?: boolean;
  systemPrompt?: boolean;
  reasoning?: boolean;
  /** P1-D:图像生成(DALL-E / gpt-image 兼容)。 */
  imageGeneration?: boolean;
  /** P1-D:语音转文字(Whisper 兼容)。 */
  audioTranscription?: boolean;
  /** P1-D:文字转语音(TTS 兼容)。 */
  audioSynthesis?: boolean;
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

// 枚举字面量类型(SQLite 用 text 列存储,pg 用 pgEnum)。
export type ApiKeyKind = "master" | "sub";
export type ProviderProtocol =
  | "openai" | "anthropic" | "gemini" | "openai-compatible"
  // P1-D:非 chat 协议族(图像生成 / 语音转写 / 语音合成,均 OpenAI 兼容格式)
  | "openai-images" | "openai-audio-stt" | "openai-audio-tts";
export type AccessScope = "public" | "internal";
export type BindingScope = "global" | "byo";
export type MessageStatus = "pending" | "streaming" | "success" | "interrupted";
