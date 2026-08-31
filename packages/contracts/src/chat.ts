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

/** RAG 轨迹中可安全展示并通过属主接口预览的文件来源。 */
export interface RagSource {
  fileId: string;
  filename: string;
  mime: string;
}

export const CHAT_PROCESS_PHASES = [
  "preparing",
  "processing",
  "answering",
  "completed",
  "failed",
  "interrupted",
] as const;

export type ChatProcessPhase = (typeof CHAT_PROCESS_PHASES)[number];
export type ChatProcessTerminalPhase = Extract<
  ChatProcessPhase,
  "completed" | "failed" | "interrupted"
>;

export const CHAT_PROCESS_STEP_STATUSES = [
  "running",
  "completed",
  "failed",
  "skipped",
  "interrupted",
] as const;

export type ChatProcessStepStatus = (typeof CHAT_PROCESS_STEP_STATUSES)[number];

export type ChatProcessSkipReason =
  | "disabled"
  | "not_needed"
  | "unavailable"
  | "empty"
  | "timeout"
  | "fallback";

interface ChatProcessStepBase {
  id: string;
  status: ChatProcessStepStatus;
  startedAt?: string;
  endedAt?: string;
}

export type ChatProcessStep =
  | (ChatProcessStepBase & {
      kind: "attachments";
      data?: { fileCount: number; mode?: "auto" | "full_context" | "rag" };
    })
  | (ChatProcessStepBase & {
      kind: "memory";
      data?: { availableCount: number; recalledCount: number };
    })
  | (ChatProcessStepBase & {
      kind: "compaction";
      data?: {
        compacted: boolean;
        originalMessageCount: number;
        sentMessageCount?: number;
      };
    })
  | (ChatProcessStepBase & {
      kind: "rag";
      data?: {
        fileCount: number;
        hitCount?: number;
        reason?: ChatProcessSkipReason;
        sources?: RagSource[];
      };
    })
  | (ChatProcessStepBase & {
      kind: "prompt";
      data?: {
        fullMessageCount: number;
        sentMessageCount: number;
        tokenEstimate: number;
      };
    })
  | (ChatProcessStepBase & { kind: "reasoning" })
  | (ChatProcessStepBase & {
      kind: "tool";
      data?: { toolCallId?: string; toolName: string };
    })
  | (ChatProcessStepBase & {
      kind: "web_search";
      data?: {
        toolCallId: string;
        backendName?: string;
        attemptCount?: number;
        citationCount?: number;
        reason?: ChatProcessSkipReason;
      };
    })
  | (ChatProcessStepBase & {
      kind: "sources";
      data?: { count: number };
    });

interface ChatProcessEventBase {
  type: "trace";
  version: 1;
  runId: string;
  seq: number;
  at: string;
  phase: ChatProcessPhase;
}

export type ChatProcessEvent =
  | (ChatProcessEventBase & { action: "phase" })
  | (ChatProcessEventBase & { action: "step"; step: ChatProcessStep });

export interface ChatProcessRunSnapshot {
  runId: string;
  phase: ChatProcessTerminalPhase;
  steps: ChatProcessStep[];
  startedAt: string;
  firstContentAt?: string;
  endedAt?: string;
}

export interface ChatProcessSnapshot {
  version: 1;
  runs: ChatProcessRunSnapshot[];
}

/** 网络边界只接受版本化的低频过程事件；具体 payload 由 kind 白名单约束。 */
export function isChatProcessEvent(value: unknown): value is ChatProcessEvent {
  if (!isRecord(value)
    || value.type !== "trace"
    || value.version !== 1
    || !isNonEmptyString(value.runId)
    || !Number.isSafeInteger(value.seq)
    || (value.seq as number) < 1
    || !isNonEmptyString(value.at)
    || !isOneOf(value.phase, CHAT_PROCESS_PHASES)
    || (value.action !== "phase" && value.action !== "step")) {
    return false;
  }
  return value.action === "phase"
    ? hasOnlyKeys(value, ["type", "version", "runId", "seq", "at", "phase", "action"])
    : hasOnlyKeys(value, ["type", "version", "runId", "seq", "at", "phase", "action", "step"])
      && isChatProcessStep(value.step);
}

export function isChatProcessSnapshot(value: unknown): value is ChatProcessSnapshot {
  return isRecord(value)
    && hasOnlyKeys(value, ["version", "runs"])
    && value.version === 1
    && Array.isArray(value.runs)
    && value.runs.every(isChatProcessRunSnapshot);
}

function isChatProcessRunSnapshot(value: unknown): value is ChatProcessRunSnapshot {
  return isRecord(value)
    && hasOnlyKeys(value, ["runId", "phase", "steps", "startedAt", "firstContentAt", "endedAt"])
    && isNonEmptyString(value.runId)
    && (value.phase === "completed" || value.phase === "failed" || value.phase === "interrupted")
    && Array.isArray(value.steps)
    && value.steps.every(isChatProcessStep)
    && isNonEmptyString(value.startedAt)
    && isOptionalString(value.firstContentAt)
    && isOptionalString(value.endedAt);
}

function isChatProcessStep(value: unknown): value is ChatProcessStep {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["id", "kind", "status", "startedAt", "endedAt", "data"])
    || !isNonEmptyString(value.id)
    || !isOneOf(value.status, CHAT_PROCESS_STEP_STATUSES)
    || !isOptionalString(value.startedAt)
    || !isOptionalString(value.endedAt)) {
    return false;
  }
  const data = value.data;
  switch (value.kind) {
    case "attachments":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["fileCount", "mode"])
        && isNonNegativeInteger(data.fileCount)
        && (data.mode === undefined || data.mode === "auto" || data.mode === "full_context" || data.mode === "rag"));
    case "memory":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["availableCount", "recalledCount"])
        && isNonNegativeInteger(data.availableCount)
        && isNonNegativeInteger(data.recalledCount));
    case "compaction":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["compacted", "originalMessageCount", "sentMessageCount"])
        && typeof data.compacted === "boolean"
        && isNonNegativeInteger(data.originalMessageCount)
        && isOptionalNonNegativeInteger(data.sentMessageCount));
    case "rag":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["fileCount", "hitCount", "reason", "sources"])
        && isNonNegativeInteger(data.fileCount)
        && isOptionalNonNegativeInteger(data.hitCount)
        && isOptionalSkipReason(data.reason)
        && (data.sources === undefined
          || (Array.isArray(data.sources) && data.sources.every(isRagSource))));
    case "prompt":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["fullMessageCount", "sentMessageCount", "tokenEstimate"])
        && isNonNegativeInteger(data.fullMessageCount)
        && isNonNegativeInteger(data.sentMessageCount)
        && isNonNegativeInteger(data.tokenEstimate));
    case "reasoning":
      return data === undefined;
    case "tool":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["toolCallId", "toolName"])
        && isNonEmptyString(data.toolName)
        && isOptionalString(data.toolCallId));
    case "web_search":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["toolCallId", "backendName", "attemptCount", "citationCount", "reason"])
        && isNonEmptyString(data.toolCallId)
        && isOptionalString(data.backendName)
        && isOptionalNonNegativeInteger(data.attemptCount)
        && isOptionalNonNegativeInteger(data.citationCount)
        && isOptionalSkipReason(data.reason));
    case "sources":
      return data === undefined || (isRecord(data)
        && hasOnlyKeys(data, ["count"])
        && isNonNegativeInteger(data.count));
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRagSource(value: unknown): value is RagSource {
  return isRecord(value)
    && hasOnlyKeys(value, ["fileId", "filename", "mime"])
    && isNonEmptyString(value.fileId)
    && isNonEmptyString(value.filename)
    && isNonEmptyString(value.mime);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalSkipReason(value: unknown): value is ChatProcessSkipReason | undefined {
  return value === undefined
    || value === "disabled"
    || value === "not_needed"
    || value === "unavailable"
    || value === "empty"
    || value === "timeout"
    || value === "fallback";
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
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
