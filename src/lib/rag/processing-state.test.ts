import { describe, expect, it } from "vitest";
import {
  FILE_PROCESSING_RETRYABLE_MESSAGE,
  RetryableFileProcessingError,
  buildFileProcessingTransition,
  formatFileProcessingError,
  normalizeUnsupportedReason,
  type ActiveFileProcessingStatus,
  type FileProcessingTransitionCommand,
} from "@/lib/rag/processing-state";

describe("file processing state contract", () => {
  it.each<{
    current: ActiveFileProcessingStatus;
    command: FileProcessingTransitionCommand;
    patch: Record<string, unknown>;
  }>([
    {
      current: "extracting",
      command: { type: "complete-unsupported", reason: "image_skipped" },
      patch: {
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
        ragReason: "image_skipped",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
      },
    },
    {
      current: "extracting",
      command: { type: "complete-extraction", chars: 12, pages: 2 },
      patch: {
        extractStatus: "done",
        extractEngine: "builtin",
        extractChars: 12,
        extractPages: 2,
        pageCount: 2,
      },
    },
    {
      current: "extracting",
      command: { type: "start-embedding", chunkCount: 3 },
      patch: { processingStatus: "embedding", chunkCount: 3 },
    },
    {
      current: "embedding",
      command: { type: "complete-empty" },
      patch: {
        processingStatus: "done",
        embedStatus: "skipped",
        embedError: null,
        ragReady: false,
        ragReason: "empty_text",
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
      },
    },
    {
      current: "embedding",
      command: { type: "mark-embedding-running" },
      patch: { embedStatus: "running", embedError: null },
    },
    {
      current: "embedding",
      command: { type: "mark-embedding-done" },
      patch: { embedStatus: "done", embedError: null },
    },
    {
      current: "embedding",
      command: {
        type: "mark-embedding-failed",
        diagnostic: "POST https://provider.example/v1?api_key=secret",
      },
      patch: { embedStatus: "error", embedError: "POST [REDACTED]" },
    },
    {
      current: "embedding",
      command: { type: "mark-embedding-skipped" },
      patch: { embedStatus: "skipped", embedError: "embedding_unavailable" },
    },
  ])("$command.type 生成唯一数据库 patch", ({ current, command, patch }) => {
    expect(buildFileProcessingTransition(current, command)).toEqual(patch);
  });

  it.each<{
    current: ActiveFileProcessingStatus;
    command: FileProcessingTransitionCommand;
  }>([
    { current: "embedding", command: { type: "complete-extraction", chars: 1, pages: 1 } },
    { current: "embedding", command: { type: "start-embedding", chunkCount: 1 } },
    { current: "extracting", command: { type: "complete-empty" } },
    { current: "extracting", command: { type: "mark-embedding-running" } },
  ])("拒绝 $current 上的非法 $command.type 转换", ({ current, command }) => {
    expect(() => buildFileProcessingTransition(current, command)).toThrow(
      "非法文件处理状态转换",
    );
  });

  it("只允许稳定的 unsupported reason 进入数据库", () => {
    expect(normalizeUnsupportedReason("pdf_not_supported")).toBe("pdf_not_supported");
    expect(normalizeUnsupportedReason("provider said token=secret")).toBe("unsupported_type");
    expect(normalizeUnsupportedReason(undefined)).toBe("unsupported_type");
  });

  it("embedding 诊断会清理 URL、已知路径和凭据并限制长度", () => {
    const storagePath = "user-1/private/report.txt";
    const raw = new Error(
      `POST https://provider.example/v1?api_key=secret ${storagePath} ${"x".repeat(300)}`,
    );

    const safe = formatFileProcessingError(raw, [storagePath], "embedding_failed");

    expect(safe.length).toBeLessThanOrEqual(200);
    expect(safe).not.toContain("provider.example");
    expect(safe).not.toContain("secret");
    expect(safe).not.toContain(storagePath);
  });

  it("可重试错误只有固定消息且不保留 cause", () => {
    const error = new RetryableFileProcessingError();

    expect(error.message).toBe(FILE_PROCESSING_RETRYABLE_MESSAGE);
    expect(error).not.toHaveProperty("cause");
  });
});
