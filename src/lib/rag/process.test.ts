import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  extractText: vi.fn(),
  chunkText: vi.fn(),
  embedTexts: vi.fn(),
  isEmbeddingAvailable: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
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
  inArray: mocks.inArray,
  and: mocks.and,
}));

import { processFile } from "@/lib/rag/process";

const schema = {
  fileObjects: { id: "fileObjects.id", processingStatus: "fileObjects.processingStatus" },
  fileChunks: { fileId: "fileChunks.fileId" },
};

function createDb(claimed: boolean) {
  const returning = vi.fn().mockResolvedValue(claimed ? [{ id: "file-1" }] : []);
  const claimWhere = vi.fn(() => ({ returning }));
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn((patch: Record<string, unknown>) => ({
    where:
      patch.processingStatus === "extracting" && patch.extractStatus === "running"
        ? claimWhere
        : updateWhere,
  }));
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const db = {
    update: vi.fn(() => ({ set })),
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  return { db, set, claimWhere, returning, deleteWhere, insertValues };
}

describe("processFile 原子抢占", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.extractText.mockResolvedValue({
      supported: false,
      reason: "unsupported",
    });
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
  });

  it("只允许 pending/error 状态原子切换到 extracting", async () => {
    const { db, set, claimWhere, returning } = createDb(true);
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(set).toHaveBeenNthCalledWith(1, {
      processingStatus: "extracting",
      extractStatus: "running",
    });
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.id, "file-1");
    expect(mocks.inArray).toHaveBeenCalledWith(schema.fileObjects.processingStatus, [
      "pending",
      "error",
    ]);
    expect(mocks.and).toHaveBeenCalledOnce();
    expect(claimWhere).toHaveBeenCalledWith(mocks.and.mock.results[0].value);
    expect(returning).toHaveBeenCalledWith({ id: schema.fileObjects.id });
  });

  it("未抢占到记录时不进入任何下游处理", async () => {
    const { db, set, deleteWhere, insertValues } = createDb(false);
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(set).toHaveBeenCalledOnce();
    expect(mocks.extractText).not.toHaveBeenCalled();
    expect(mocks.chunkText).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("抢占成功后保持 unsupported 文件状态流转", async () => {
    const { db, set } = createDb(true);
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(mocks.extractText).toHaveBeenCalledWith("user/file.txt", "text/plain");
    expect(set).toHaveBeenNthCalledWith(2, {
      processingStatus: "done",
      extractStatus: "skipped",
      ragReady: false,
      ragReason: "unsupported",
    });
  });
});
