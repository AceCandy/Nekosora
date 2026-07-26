import { beforeEach, describe, expect, it, vi } from "vitest";

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

function createDb(
  claimed: boolean,
  loseLeaseOn?: (patch: Record<string, unknown>) => boolean,
) {
  const returning = vi.fn().mockResolvedValue(claimed ? [{ id: "file-1" }] : []);
  const claimWhere = vi.fn(() => ({ returning }));
  const persistedPatches: Record<string, unknown>[] = [];
  let leaseLost = false;
  const set = vi.fn((patch: Record<string, unknown>) => {
    if (patch.processingStatus === "extracting" && patch.extractStatus === "running") {
      return { where: claimWhere };
    }
    const updateReturning = vi.fn(async () => {
      if (leaseLost || loseLeaseOn?.(patch)) {
        leaseLost = true;
        return [];
      }
      persistedPatches.push(patch);
      return [{ id: "file-1" }];
    });
    return { where: vi.fn(() => ({ returning: updateReturning })) };
  });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const db = {
    update: vi.fn(() => ({ set })),
    delete: vi.fn(() => ({ where: deleteWhere })),
    insert: vi.fn(() => ({ values: insertValues })),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(async (callback) => callback(db));
  return { db, set, claimWhere, returning, persistedPatches, deleteWhere, insertValues };
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
    mocks.gt.mockImplementation((left, right) => ({ op: "gt", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.isNull.mockImplementation((value) => ({ op: "isNull", value }));
    mocks.lte.mockImplementation((left, right) => ({ op: "lte", left, right }));
    mocks.or.mockImplementation((...conditions) => ({ op: "or", conditions }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
  });

  it("以 token 和数据库租约原子 claim 可处理状态", async () => {
    const { db, set, claimWhere, returning } = createDb(true);
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(set).toHaveBeenNthCalledWith(1, {
      processingStatus: "extracting",
      processingLeaseId: expect.any(String),
      processingLeaseExpiresAt: expect.objectContaining({
        op: "sql",
        text: expect.stringContaining("now()"),
      }),
      extractStatus: "running",
    });
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.id, "file-1");
    expect(mocks.inArray).toHaveBeenCalledWith(schema.fileObjects.processingStatus, [
      "pending",
      "error",
    ]);
    expect(mocks.inArray).toHaveBeenCalledWith(schema.fileObjects.processingStatus, [
      "extracting",
      "embedding",
    ]);
    expect(mocks.isNull).toHaveBeenCalledWith(schema.fileObjects.processingLeaseExpiresAt);
    expect(claimWhere).toHaveBeenCalledWith(expect.objectContaining({ op: "and" }));
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
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    });
  });

  it("embedding 失败时持久化文本块但不标记为可检索", async () => {
    const embeddingError = new Error("embedding failed");
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
    mocks.embedTexts.mockRejectedValue(embeddingError);
    const { db, set, insertValues } = createDb(true);
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(set).toHaveBeenCalledWith({
      embedStatus: "error",
      embedError: embeddingError.message,
    });
    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ fileId: "file-1", content: "hello", embedding: null }),
    ]);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      processingStatus: "done",
      ragReady: false,
      ragReason: "embedding_failed",
    }));
  });

  it("unsupported 终态失租约时不覆盖新 owner", async () => {
    const { db, persistedPatches } = createDb(
      true,
      (patch) => patch.processingStatus === "done",
    );
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(persistedPatches).not.toContainEqual(
      expect.objectContaining({ processingStatus: "done" }),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("empty_text 终态失租约时不覆盖新 owner", async () => {
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "",
      chars: 0,
      pages: 0,
    });
    mocks.chunkText.mockReturnValue([]);
    const { db, persistedPatches } = createDb(
      true,
      (patch) => patch.ragReason === "empty_text",
    );
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(persistedPatches).not.toContainEqual(
      expect.objectContaining({ ragReason: "empty_text" }),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("普通异常收敛时失租约不写 error 终态", async () => {
    const processingError = new Error("extract failed");
    mocks.extractText.mockRejectedValue(processingError);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, persistedPatches } = createDb(
      true,
      (patch) => patch.processingStatus === "error",
    );
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(persistedPatches).not.toContainEqual(
      expect.objectContaining({ processingStatus: "error" }),
    );
    expect(db.transaction).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it.each([
    ["extractStatus=done", (patch: Record<string, unknown>) => patch.extractStatus === "done"],
    [
      "processingStatus=embedding",
      (patch: Record<string, unknown>) => patch.processingStatus === "embedding",
    ],
  ])("%s 写入失租约后停止后续处理", async (_stage, loseLeaseOn) => {
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "hello",
      chars: 5,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, charOffset: 0, content: "hello", tokenCount: 1 },
    ]);
    const { db } = createDb(true, loseLeaseOn);
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(mocks.isEmbeddingAvailable).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["running", vi.fn().mockResolvedValue([[0.1]])],
    ["done", vi.fn().mockResolvedValue([[0.1]])],
    ["error", vi.fn().mockRejectedValue(new Error("embedding failed"))],
  ])("embedStatus=%s 写入失租约后不进入 chunk 事务", async (lostStatus, embed) => {
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
    mocks.embedTexts.mockImplementation(embed);
    const { db, set, persistedPatches } = createDb(
      true,
      (patch) => patch.embedStatus === lostStatus,
    );
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(persistedPatches).not.toContainEqual(
      expect.objectContaining({ processingStatus: "done" }),
    );
    if (lostStatus !== "error") {
      expect(set).not.toHaveBeenCalledWith(
        expect.objectContaining({ embedStatus: "error" }),
      );
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("chunk 事务首步失租约时不删除或插入 chunks", async () => {
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "hello",
      chars: 5,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, charOffset: 0, content: "hello", tokenCount: 1 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(false);
    const { db, deleteWhere, insertValues } = createDb(
      true,
      (patch) => Object.keys(patch).length === 1 && Boolean(patch.processingLeaseExpiresAt),
    );
    mocks.getDb.mockResolvedValue(db);

    await processFile("file-1", "user/file.txt", "text/plain");

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
