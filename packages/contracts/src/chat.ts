export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

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

/** 将数据库或 JSON 边界中的消息时间收敛为 ISO 字符串。 */
export function toMessageCreatedAtIso(value: unknown): string | undefined {
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
