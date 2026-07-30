import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimFileProcessing: vi.fn(),
  completeFileProcessingWithoutChunks: vi.fn(),
  renewFileProcessingLease: vi.fn(),
  transitionFileProcessing: vi.fn(),
  failFileProcessing: vi.fn(),
  replaceFileChunksAndComplete: vi.fn(),
  extractText: vi.fn(),
  chunkText: vi.fn(),
  embedTexts: vi.fn(),
  isEmbeddingAvailable: vi.fn(),
}));

vi.mock("@/lib/rag/processing-repository", () => ({
  claimFileProcessing: mocks.claimFileProcessing,
  completeFileProcessingWithoutChunks: mocks.completeFileProcessingWithoutChunks,
  renewFileProcessingLease: mocks.renewFileProcessingLease,
  transitionFileProcessing: mocks.transitionFileProcessing,
  failFileProcessing: mocks.failFileProcessing,
  replaceFileChunksAndComplete: mocks.replaceFileChunksAndComplete,
}));
vi.mock("@/lib/rag/extract", () => ({ extractText: mocks.extractText }));
vi.mock("@/lib/rag/chunk", () => ({ chunkText: mocks.chunkText }));
vi.mock("@/lib/rag/embedding", () => ({
  embedTexts: mocks.embedTexts,
  isEmbeddingAvailable: mocks.isEmbeddingAvailable,
}));

import { processFile } from "@/lib/rag/processing-coordinator";
import {
  FILE_PROCESSING_RETRYABLE_MESSAGE,
  FileProcessingLeaseLostError,
  RetryableFileProcessingError,
} from "@/lib/rag/processing-state";

const lease = { fileId: "file-1", token: "lease-token" };
const claimed = {
  lease,
  storagePath: "canonical/private/file.txt",
  mime: "text/plain",
};

describe("file processing coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimFileProcessing.mockResolvedValue(claimed);
    mocks.completeFileProcessingWithoutChunks.mockResolvedValue(undefined);
    mocks.renewFileProcessingLease.mockResolvedValue(undefined);
    mocks.transitionFileProcessing.mockResolvedValue(undefined);
    mocks.failFileProcessing.mockResolvedValue(undefined);
    mocks.replaceFileChunksAndComplete.mockResolvedValue(undefined);
    mocks.extractText.mockResolvedValue({
      supported: false,
      reason: "unsupported_type",
    });
    mocks.chunkText.mockReturnValue([]);
    mocks.isEmbeddingAvailable.mockResolvedValue(false);
    mocks.embedTexts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("只接收 fileId 并使用 claim 返回的 canonical metadata", async () => {
    await processFile("file-1");

    expect(mocks.claimFileProcessing).toHaveBeenCalledWith("file-1");
    expect(mocks.extractText).toHaveBeenCalledWith(
      "canonical/private/file.txt",
      "text/plain",
    );
    expect(mocks.completeFileProcessingWithoutChunks).toHaveBeenCalledWith(
      lease,
      "extracting",
      { type: "complete-unsupported", reason: "unsupported_type" },
    );
  });

  it("claim miss 是并发 loser no-op", async () => {
    mocks.claimFileProcessing.mockResolvedValue(null);

    await expect(processFile("file-1")).resolves.toBeUndefined();

    expect(mocks.extractText).not.toHaveBeenCalled();
    expect(mocks.transitionFileProcessing).not.toHaveBeenCalled();
  });

  it("unknown unsupported reason 不会原样写入", async () => {
    mocks.extractText.mockResolvedValue({
      supported: false,
      reason: "token=secret",
    });

    await processFile("file-1");

    expect(mocks.completeFileProcessingWithoutChunks).toHaveBeenCalledWith(
      lease,
      "extracting",
      { type: "complete-unsupported", reason: "unsupported_type" },
    );
  });

  it("完整流水线按阶段写入并原子完成 chunks", async () => {
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "hello",
      chars: 5,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, content: "hello", tokenCount: 1, charOffset: 0 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(true);
    mocks.embedTexts.mockResolvedValue([[0.1, 0.2]]);

    await processFile("file-1");

    expect(mocks.transitionFileProcessing.mock.calls).toEqual([
      [lease, "extracting", { type: "complete-extraction", chars: 5, pages: 1 }],
      [lease, "extracting", { type: "start-embedding", chunkCount: 1 }],
      [lease, "embedding", { type: "mark-embedding-running" }],
      [lease, "embedding", { type: "mark-embedding-done" }],
    ]);
    expect(mocks.replaceFileChunksAndComplete).toHaveBeenCalledWith(lease, {
      chunks: [{
        chunkIndex: 0,
        pageNum: 1,
        charOffset: 0,
        content: "hello",
        tokenCount: 1,
        embedding: [0.1, 0.2],
      }],
      ragReady: true,
      ragReason: null,
    });
  });

  it("empty text 正常收敛且不进入 embedding/persistence", async () => {
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "",
      chars: 0,
      pages: null,
    });
    mocks.chunkText.mockReturnValue([]);

    await processFile("file-1");

    expect(mocks.completeFileProcessingWithoutChunks).toHaveBeenLastCalledWith(
      lease,
      "embedding",
      { type: "complete-empty" },
    );
    expect(mocks.isEmbeddingAvailable).not.toHaveBeenCalled();
    expect(mocks.replaceFileChunksAndComplete).not.toHaveBeenCalled();
  });

  it("embedding unavailable 保留文本 chunks 并降级完成", async () => {
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "hello",
      chars: 5,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, content: "hello", tokenCount: 1, charOffset: 0 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(false);

    await processFile("file-1");

    expect(mocks.transitionFileProcessing).toHaveBeenLastCalledWith(
      lease,
      "embedding",
      { type: "mark-embedding-skipped" },
    );
    expect(mocks.replaceFileChunksAndComplete).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        ragReady: false,
        ragReason: "embedding_unavailable",
        chunks: [expect.objectContaining({ embedding: null })],
      }),
    );
  });

  it("embedding failure 只传递安全诊断并降级完成", async () => {
    const error = new Error(
      "POST https://provider.example/v1?api_key=secret canonical/private/file.txt",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "hello",
      chars: 5,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, content: "hello", tokenCount: 1, charOffset: 0 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(true);
    mocks.embedTexts.mockRejectedValue(error);

    await processFile("file-1");

    const failedCommand = mocks.transitionFileProcessing.mock.calls.find(
      ([, , command]) => command.type === "mark-embedding-failed",
    )?.[2];
    expect(failedCommand).toEqual({
      type: "mark-embedding-failed",
      diagnostic: "POST [REDACTED] [REDACTED]",
    });
    expect(mocks.replaceFileChunksAndComplete).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ ragReady: false, ragReason: "embedding_failed" }),
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("provider.example");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("secret");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(claimed.storagePath);
  });

  it("embedding 返回数量不足时按失败降级且不标记 rag ready", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "first second",
      chars: 12,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, content: "first", tokenCount: 1, charOffset: 0 },
      { index: 1, content: "second", tokenCount: 1, charOffset: 6 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(true);
    mocks.embedTexts.mockResolvedValue([[0.1, 0.2]]);

    await processFile("file-1");

    expect(mocks.transitionFileProcessing).toHaveBeenCalledWith(
      lease,
      "embedding",
      expect.objectContaining({ type: "mark-embedding-failed" }),
    );
    expect(mocks.replaceFileChunksAndComplete).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({
        ragReady: false,
        ragReason: "embedding_failed",
        chunks: [
          expect.objectContaining({ embedding: null }),
          expect.objectContaining({ embedding: null }),
        ],
      }),
    );
  });

  it.each([
    ["extraction_failed", () => mocks.extractText.mockRejectedValue(new Error("extract secret"))],
    ["chunking_failed", () => {
      mocks.extractText.mockResolvedValue({
        supported: true,
        text: "hello",
        chars: 5,
        pages: 1,
      });
      mocks.chunkText.mockImplementation(() => {
        throw new Error("chunk secret");
      });
    }],
    ["persistence_failed", () => {
      mocks.extractText.mockResolvedValue({
        supported: true,
        text: "hello",
        chars: 5,
        pages: 1,
      });
      mocks.transitionFileProcessing.mockRejectedValueOnce(new Error("postgresql://user:pass@db/app"));
    }],
  ] as const)("%s 写 stable error 后向调用方抛固定错误", async (reason, arrange) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    arrange();

    const rejection = processFile("file-1");

    await expect(rejection).rejects.toBeInstanceOf(RetryableFileProcessingError);
    await expect(rejection).rejects.toMatchObject({
      message: FILE_PROCESSING_RETRYABLE_MESSAGE,
    });
    expect(mocks.failFileProcessing).toHaveBeenCalledWith(lease, reason);
    const caught = await rejection.catch((error) => error as Error);
    expect(caught).not.toHaveProperty("cause");
  });

  it("阶段写入失租后不写 error", async () => {
    mocks.completeFileProcessingWithoutChunks.mockRejectedValueOnce(
      new FileProcessingLeaseLostError(),
    );

    await expect(processFile("file-1")).resolves.toBeUndefined();

    expect(mocks.failFileProcessing).not.toHaveBeenCalled();
  });

  it("error write 已失租时按 ownership no-op 收敛", async () => {
    mocks.extractText.mockRejectedValue(new Error("extract failed"));
    mocks.failFileProcessing.mockRejectedValue(new FileProcessingLeaseLostError());
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(processFile("file-1")).resolves.toBeUndefined();
  });

  it("claim 数据库失败也只向调用方抛固定错误", async () => {
    mocks.claimFileProcessing.mockRejectedValue(
      new Error("postgresql://user:password@db/private?token=secret"),
    );

    const rejection = processFile("file-1");

    await expect(rejection).rejects.toMatchObject({
      message: FILE_PROCESSING_RETRYABLE_MESSAGE,
    });
  });
});
