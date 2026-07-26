import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  extractText: vi.fn(),
  chunkText: vi.fn(),
  embedTexts: vi.fn(),
  isEmbeddingAvailable: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  and: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray) => ({
    op: "sql",
    text: strings.join("?"),
  })),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/rag/extract", () => ({ extractText: mocks.extractText }));
vi.mock("@/lib/rag/chunk", () => ({ chunkText: mocks.chunkText }));
vi.mock("@/lib/rag/embedding", () => ({
  embedTexts: mocks.embedTexts,
  isEmbeddingAvailable: mocks.isEmbeddingAvailable,
}));
vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  gt: mocks.gt,
  inArray: mocks.inArray,
  isNull: mocks.isNull,
  lte: mocks.lte,
  or: mocks.or,
  and: mocks.and,
  sql: mocks.sql,
}));

import { processFile } from "@/lib/rag/process";

const schema = {
  fileObjects: {
    id: "fileObjects.id",
    processingStatus: "fileObjects.processingStatus",
    processingLeaseId: "fileObjects.processingLeaseId",
    processingLeaseExpiresAt: "fileObjects.processingLeaseExpiresAt",
  },
  fileChunks: { fileId: "fileChunks.fileId" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("processFile heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("长时处理期间单飞续租并在结束后停止调度", async () => {
    const extraction = deferred<{ supported: false; reason: string }>();
    const firstRenewal = deferred<Array<{ id: string }>>();
    const secondRenewal = deferred<Array<{ id: string }>>();
    const renewals = [firstRenewal, secondRenewal];
    let renewalCount = 0;
    const set = vi.fn((patch: Record<string, unknown>) => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => {
          if (patch.processingStatus === "extracting") {
            return Promise.resolve([{ id: "file-1" }]);
          }
          if (Object.keys(patch).length === 1 && patch.processingLeaseExpiresAt) {
            const renewal = renewals[renewalCount++];
            return renewal.promise;
          }
          return Promise.resolve([{ id: "file-1" }]);
        }),
      })),
    }));
    mocks.getDb.mockResolvedValue({ update: vi.fn(() => ({ set })) });
    mocks.extractText.mockReturnValue(extraction.promise);

    const processing = processFile("file-1", "user/file.txt", "text/plain");
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewalCount).toBe(1);

    firstRenewal.resolve([{ id: "file-1" }]);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renewalCount).toBe(2);

    secondRenewal.resolve([{ id: "file-1" }]);
    extraction.resolve({ supported: false, reason: "unsupported" });
    await processing;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewalCount).toBe(2);
  });

  it("续租失败后不再执行终态或 chunk 写入", async () => {
    const extraction = deferred<{ supported: false; reason: string }>();
    const patches: Record<string, unknown>[] = [];
    const set = vi.fn((patch: Record<string, unknown>) => {
      patches.push(patch);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => {
            if (patch.processingStatus === "extracting") return Promise.resolve([{ id: "file-1" }]);
            if (Object.keys(patch).length === 1 && patch.processingLeaseExpiresAt) {
              return Promise.resolve([]);
            }
            return Promise.resolve([{ id: "file-1" }]);
          }),
        })),
      };
    });
    const transaction = vi.fn();
    mocks.getDb.mockResolvedValue({ update: vi.fn(() => ({ set })), transaction });
    mocks.extractText.mockReturnValue(extraction.promise);

    const processing = processFile("file-1", "user/file.txt", "text/plain");
    await vi.advanceTimersByTimeAsync(30_000);
    extraction.resolve({ supported: false, reason: "unsupported" });
    await processing;

    expect(patches).toHaveLength(2);
    expect(patches).not.toContainEqual(expect.objectContaining({ processingStatus: "done" }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it("embedding 在途时续租失败会丢弃晚返回结果", async () => {
    const embedding = deferred<number[][]>();
    const patches: Record<string, unknown>[] = [];
    const set = vi.fn((patch: Record<string, unknown>) => {
      patches.push(patch);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => {
            if (patch.processingStatus === "extracting") return Promise.resolve([{ id: "file-1" }]);
            if (Object.keys(patch).length === 1 && patch.processingLeaseExpiresAt) {
              return Promise.resolve([]);
            }
            return Promise.resolve([{ id: "file-1" }]);
          }),
        })),
      };
    });
    const transaction = vi.fn();
    mocks.getDb.mockResolvedValue({ update: vi.fn(() => ({ set })), transaction });
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "hello",
      chars: 5,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, charOffset: 0, content: "hello", tokenCount: 1 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(true);
    mocks.embedTexts.mockReturnValue(embedding.promise);

    const processing = processFile("file-1", "user/file.txt", "text/plain");
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.embedTexts).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    embedding.resolve([[0.1, 0.2]]);
    await processing;

    expect(patches).not.toContainEqual({ embedStatus: "done" });
    expect(patches).not.toContainEqual(expect.objectContaining({ embedStatus: "error" }));
    expect(transaction).not.toHaveBeenCalled();
  });
});
