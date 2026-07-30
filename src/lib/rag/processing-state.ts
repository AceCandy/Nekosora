import { redactErrorMessage } from "@/lib/redaction";
import { FILE_PROCESS_QUEUE } from "@/lib/jobs/catalog";

export const FILE_PROCESSING_RETRYABLE_MESSAGE = FILE_PROCESS_QUEUE.retryMessage;
const MAX_FILE_PROCESSING_ERROR_LENGTH = 200;
const URL_RE = /\b(?:https?|postgres(?:ql)?):\/\/[^\s"'<>]+/gi;

export type FileProcessingStatus =
  | "pending"
  | "error"
  | "extracting"
  | "embedding"
  | "done";

export type ActiveFileProcessingStatus = Extract<
  FileProcessingStatus,
  "extracting" | "embedding"
>;

export type UnsupportedFileProcessingReason =
  | "pdf_not_supported"
  | "office_not_supported"
  | "image_skipped"
  | "unsupported_type";

export type DegradedFileProcessingReason =
  | "embedding_unavailable"
  | "embedding_failed";

export type RetryableFileProcessingReason =
  | "extraction_failed"
  | "chunking_failed"
  | "persistence_failed";

export type FileProcessingReason =
  | UnsupportedFileProcessingReason
  | "empty_text"
  | DegradedFileProcessingReason
  | RetryableFileProcessingReason;

export type FileProcessingTransitionCommand =
  | { type: "complete-unsupported"; reason: UnsupportedFileProcessingReason }
  | { type: "complete-extraction"; chars: number; pages: number | null }
  | { type: "start-embedding"; chunkCount: number }
  | { type: "complete-empty" }
  | { type: "mark-embedding-running" }
  | { type: "mark-embedding-done" }
  | { type: "mark-embedding-failed"; diagnostic: string }
  | { type: "mark-embedding-skipped" };

export type TerminalFileProcessingTransitionCommand = Extract<
  FileProcessingTransitionCommand,
  { type: "complete-unsupported" | "complete-empty" }
>;

export type StageFileProcessingTransitionCommand = Exclude<
  FileProcessingTransitionCommand,
  TerminalFileProcessingTransitionCommand
>;

export class FileProcessingLeaseLostError extends Error {
  constructor() {
    super("文件处理租约已失效");
    this.name = "FileProcessingLeaseLostError";
  }
}

export class RetryableFileProcessingError extends Error {
  constructor() {
    super(FILE_PROCESSING_RETRYABLE_MESSAGE);
    this.name = "RetryableFileProcessingError";
  }
}

/** 将内部异常收敛为不含 URL、已知秘密且有长度上限的诊断文本。 */
export function formatFileProcessingError(
  error: unknown,
  secrets: readonly string[] = [],
  fallback = "文件处理失败",
): string {
  return redactErrorMessage(error, secrets, fallback)
    .replace(URL_RE, "[REDACTED]")
    .slice(0, MAX_FILE_PROCESSING_ERROR_LENGTH);
}

/** 提取器的自由文本 reason 不能直接进入 rag_reason。 */
export function normalizeUnsupportedReason(
  reason: unknown,
): UnsupportedFileProcessingReason {
  switch (reason) {
    case "pdf_not_supported":
    case "office_not_supported":
    case "image_skipped":
    case "unsupported_type":
      return reason;
    default:
      return "unsupported_type";
  }
}

/** 将有限状态命令翻译为唯一数据库 patch，并拒绝跨阶段调用。 */
export function buildFileProcessingTransition(
  current: ActiveFileProcessingStatus,
  command: FileProcessingTransitionCommand,
): Record<string, unknown> {
  switch (command.type) {
    case "complete-unsupported":
      requireStatus(current, "extracting", command.type);
      return {
        processingStatus: "done",
        extractStatus: "skipped",
        extractEngine: null,
        extractChars: null,
        extractPages: null,
        pageCount: null,
        chunkCount: 0,
        embedStatus: "skipped",
        embedError: null,
        ragReady: false,
        ragReason: command.reason,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
      };
    case "complete-extraction":
      requireStatus(current, "extracting", command.type);
      return {
        extractStatus: "done",
        extractEngine: "builtin",
        extractChars: command.chars,
        extractPages: command.pages,
        pageCount: command.pages,
      };
    case "start-embedding":
      requireStatus(current, "extracting", command.type);
      return {
        processingStatus: "embedding",
        chunkCount: command.chunkCount,
      };
    case "complete-empty":
      requireStatus(current, "embedding", command.type);
      return {
        processingStatus: "done",
        embedStatus: "skipped",
        embedError: null,
        ragReady: false,
        ragReason: "empty_text",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
      };
    case "mark-embedding-running":
      requireStatus(current, "embedding", command.type);
      return { embedStatus: "running", embedError: null };
    case "mark-embedding-done":
      requireStatus(current, "embedding", command.type);
      return { embedStatus: "done", embedError: null };
    case "mark-embedding-failed":
      requireStatus(current, "embedding", command.type);
      return {
        embedStatus: "error",
        embedError: formatFileProcessingError(command.diagnostic, [], "embedding_failed"),
      };
    case "mark-embedding-skipped":
      requireStatus(current, "embedding", command.type);
      return {
        embedStatus: "skipped",
        embedError: "embedding_unavailable",
      };
    default:
      return assertNever(command);
  }
}

function requireStatus(
  current: ActiveFileProcessingStatus,
  expected: ActiveFileProcessingStatus,
  command: FileProcessingTransitionCommand["type"],
): void {
  if (current !== expected) {
    throw new Error(`非法文件处理状态转换: ${current} -> ${command}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`未知文件处理命令: ${String(value)}`);
}
