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

const lease = { fileId: "file-1", token: "lease-token" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("file processing heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.claimFileProcessing.mockResolvedValue({
      lease,
      storagePath: "canonical/file.txt",
      mime: "text/plain",
    });
    mocks.completeFileProcessingWithoutChunks.mockResolvedValue(undefined);
    mocks.transitionFileProcessing.mockResolvedValue(undefined);
    mocks.failFileProcessing.mockResolvedValue(undefined);
    mocks.replaceFileChunksAndComplete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("长时处理期间 heartbeat 单飞且结束后停止", async () => {
    const extraction = deferred<{ supported: false; reason: string }>();
    const firstRenewal = deferred<void>();
    const secondRenewal = deferred<void>();
    mocks.extractText.mockReturnValue(extraction.promise);
    mocks.renewFileProcessingLease
      .mockReturnValueOnce(firstRenewal.promise)
      .mockReturnValueOnce(secondRenewal.promise);

    const processing = processFile("file-1");
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.renewFileProcessingLease).toHaveBeenCalledOnce();

    firstRenewal.resolve(undefined);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.renewFileProcessingLease).toHaveBeenCalledTimes(2);

    secondRenewal.resolve(undefined);
    extraction.resolve({ supported: false, reason: "unsupported_type" });
    await processing;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.renewFileProcessingLease).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["zero-row", new Error("lease lost")],
    ["database reject", new Error("postgresql://user:pass@db/app")],
  ])("heartbeat %s 后不再写任何领域状态", async (_kind, renewalError) => {
    const extraction = deferred<{ supported: false; reason: string }>();
    mocks.extractText.mockReturnValue(extraction.promise);
    mocks.renewFileProcessingLease.mockRejectedValue(renewalError);

    const processing = processFile("file-1");
    await vi.advanceTimersByTimeAsync(30_000);
    extraction.resolve({ supported: false, reason: "unsupported_type" });
    await processing;

    expect(mocks.transitionFileProcessing).not.toHaveBeenCalled();
    expect(mocks.completeFileProcessingWithoutChunks).not.toHaveBeenCalled();
    expect(mocks.failFileProcessing).not.toHaveBeenCalled();
    expect(mocks.replaceFileChunksAndComplete).not.toHaveBeenCalled();
  });

  it("embedding 在途时失租会丢弃晚返回结果", async () => {
    const embedding = deferred<number[][]>();
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
    mocks.embedTexts.mockReturnValue(embedding.promise);
    mocks.renewFileProcessingLease.mockRejectedValue(new Error("renew failed"));

    const processing = processFile("file-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.embedTexts).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    embedding.resolve([[0.1, 0.2]]);
    await processing;

    expect(mocks.transitionFileProcessing).not.toHaveBeenCalledWith(
      lease,
      "embedding",
      { type: "mark-embedding-done" },
    );
    expect(mocks.replaceFileChunksAndComplete).not.toHaveBeenCalled();
    expect(mocks.failFileProcessing).not.toHaveBeenCalled();
  });

  it("所有出口会等待在途 heartbeat 后再返回", async () => {
    const extraction = deferred<{ supported: false; reason: string }>();
    const renewal = deferred<void>();
    mocks.extractText.mockReturnValue(extraction.promise);
    mocks.renewFileProcessingLease.mockReturnValue(renewal.promise);

    let settled = false;
    const processing = processFile("file-1").then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    extraction.resolve({ supported: false, reason: "unsupported_type" });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    renewal.resolve(undefined);
    await processing;
    expect(settled).toBe(true);
  });
});
