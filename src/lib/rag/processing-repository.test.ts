import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray) => ({
    op: "sql",
    text: strings.join("?"),
  })),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  gt: mocks.gt,
  inArray: mocks.inArray,
  isNull: mocks.isNull,
  lte: mocks.lte,
  or: mocks.or,
  and: mocks.and,
  asc: mocks.asc,
  sql: mocks.sql,
}));

import {
  claimFileProcessing,
  completeFileProcessingWithoutChunks,
  failFileProcessing,
  findRecoverableFileIds,
  renewFileProcessingLease,
  replaceFileChunksAndComplete,
  transitionFileProcessing,
} from "@/lib/rag/processing-repository";
import { FileProcessingLeaseLostError } from "@/lib/rag/processing-state";

const schema = {
  fileObjects: {
    id: "fileObjects.id",
    storagePath: "fileObjects.storagePath",
    mime: "fileObjects.mime",
    createdAt: "fileObjects.createdAt",
    processingStatus: "fileObjects.processingStatus",
    processingLeaseId: "fileObjects.processingLeaseId",
    processingLeaseExpiresAt: "fileObjects.processingLeaseExpiresAt",
  },
  fileChunks: { fileId: "fileChunks.fileId" },
};

const lease = { fileId: "file-1", token: "lease-token" };

function updateDb(returned: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returned);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update }, update, set, where, returning };
}

describe("file processing repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.gt.mockImplementation((left, right) => ({ op: "gt", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.isNull.mockImplementation((value) => ({ op: "isNull", value }));
    mocks.lte.mockImplementation((left, right) => ({ op: "lte", left, right }));
    mocks.or.mockImplementation((...conditions) => ({ op: "or", conditions }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
    mocks.asc.mockImplementation((value) => ({ op: "asc", value }));
  });

  it("claim 在同一条件更新中返回 canonical storagePath 和 mime", async () => {
    const { db, set, where, returning } = updateDb([
      { id: "file-1", storagePath: "canonical/file.txt", mime: "text/plain" },
    ]);
    mocks.getDb.mockResolvedValue(db);

    const claimed = await claimFileProcessing("file-1");

    expect(claimed).toEqual({
      lease: { fileId: "file-1", token: expect.any(String) },
      storagePath: "canonical/file.txt",
      mime: "text/plain",
    });
    expect(set).toHaveBeenCalledWith({
      processingStatus: "extracting",
      processingLeaseId: expect.any(String),
      processingLeaseExpiresAt: expect.objectContaining({ text: expect.stringContaining("now()") }),
      extractStatus: "running",
    });
    expect(where).toHaveBeenCalledWith(expect.objectContaining({ op: "and" }));
    expect(returning).toHaveBeenCalledWith({
      id: schema.fileObjects.id,
      storagePath: schema.fileObjects.storagePath,
      mime: schema.fileObjects.mime,
    });
  });

  it("claim 未命中时返回 null", async () => {
    const { db } = updateDb([]);
    mocks.getDb.mockResolvedValue(db);

    await expect(claimFileProcessing("file-1")).resolves.toBeNull();
  });

  it("阶段转换同时校验 token、阶段和数据库时钟", async () => {
    const { db, set } = updateDb([{ id: "file-1" }]);
    mocks.getDb.mockResolvedValue(db);

    await transitionFileProcessing(lease, "extracting", {
      type: "complete-extraction",
      chars: 8,
      pages: 1,
    });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      extractStatus: "done",
      extractChars: 8,
    }));
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.processingLeaseId, lease.token);
    expect(mocks.inArray).toHaveBeenCalledWith(schema.fileObjects.processingStatus, [
      "extracting",
    ]);
    expect(mocks.gt).toHaveBeenCalledWith(
      schema.fileObjects.processingLeaseExpiresAt,
      expect.objectContaining({ text: "now()" }),
    );
  });

  it("renew zero-row 统一为 lease lost", async () => {
    const { db } = updateDb([]);
    mocks.getDb.mockResolvedValue(db);

    await expect(renewFileProcessingLease(lease)).rejects.toBeInstanceOf(
      FileProcessingLeaseLostError,
    );
  });

  it("retryable failure 只写稳定 code 并清理租约", async () => {
    const { db, set } = updateDb([{ id: "file-1" }]);
    mocks.getDb.mockResolvedValue(db);

    await failFileProcessing(lease, "chunking_failed");

    expect(set).toHaveBeenCalledWith({
      processingStatus: "error",
      ragReady: false,
      ragReason: "chunking_failed",
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    });
  });

  it("recoverable scan 只返回稳定排序后的 25 个 id", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "file-1" }, { id: "file-2" }]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    mocks.getDb.mockResolvedValue({ select });

    await expect(findRecoverableFileIds()).resolves.toEqual(["file-1", "file-2"]);

    expect(select).toHaveBeenCalledWith({ id: schema.fileObjects.id });
    expect(orderBy).toHaveBeenCalledWith(
      { op: "asc", value: schema.fileObjects.createdAt },
      { op: "asc", value: schema.fileObjects.id },
    );
    expect(limit).toHaveBeenCalledWith(25);
    expect(mocks.inArray).toHaveBeenCalledWith(schema.fileObjects.processingStatus, [
      "extracting",
      "embedding",
    ]);
  });

  it("chunk replacement 分批写入并以 statement time 完成同一事务", async () => {
    const forUpdate = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const limit = vi.fn(() => ({ for: forUpdate }));
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const firstReturning = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const finalReturning = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const set = vi
      .fn()
      .mockReturnValueOnce({ where: vi.fn(() => ({ returning: firstReturning })) })
      .mockReturnValueOnce({ where: vi.fn(() => ({ returning: finalReturning })) });
    const update = vi.fn(() => ({ set }));
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteRows = vi.fn(() => ({ where: deleteWhere }));
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values: insertValues }));
    const tx = { select, update, delete: deleteRows, insert };
    const transaction = vi.fn(async (callback) => callback(tx));
    mocks.getDb.mockResolvedValue({ transaction });
    const chunks = Array.from({ length: 51 }, (_, index) => ({
      chunkIndex: index,
      pageNum: 1,
      charOffset: index,
      content: `chunk-${index}`,
      tokenCount: 1,
      embedding: index === 0 ? [0.1, 0.2] : null,
    }));

    await replaceFileChunksAndComplete(lease, {
      chunks,
      ragReady: true,
      ragReason: null,
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(forUpdate).toHaveBeenCalledWith("update");
    expect(deleteWhere).toHaveBeenCalledWith(expect.objectContaining({ op: "eq" }));
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(insertValues.mock.calls[0]?.[0]).toHaveLength(50);
    expect(insertValues.mock.calls[1]?.[0]).toHaveLength(1);
    expect(insertValues.mock.calls[0]?.[0][0]).toMatchObject({
      fileId: "file-1",
      embedding: [0.1, 0.2],
    });
    expect(set).toHaveBeenLastCalledWith({
      processingStatus: "done",
      ragReady: true,
      ragReason: null,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    });
    expect(set).toHaveBeenNthCalledWith(1, {
      processingLeaseExpiresAt: expect.objectContaining({
        text: "statement_timestamp() + interval '2 minutes'",
      }),
    });
    expect(mocks.gt).toHaveBeenCalledWith(
      schema.fileObjects.processingLeaseExpiresAt,
      expect.objectContaining({ text: "statement_timestamp()" }),
    );
  });

  it("unsupported/empty 终态在同一事务清理旧 chunks", async () => {
    const forUpdate = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const limit = vi.fn(() => ({ for: forUpdate }));
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const firstReturning = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const finalReturning = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const set = vi
      .fn()
      .mockReturnValueOnce({ where: vi.fn(() => ({ returning: firstReturning })) })
      .mockReturnValueOnce({ where: vi.fn(() => ({ returning: finalReturning })) });
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const tx = {
      select,
      update: vi.fn(() => ({ set })),
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(),
    };
    const transaction = vi.fn(async (callback) => callback(tx));
    mocks.getDb.mockResolvedValue({ transaction });

    await completeFileProcessingWithoutChunks(lease, "extracting", {
      type: "complete-unsupported",
      reason: "unsupported_type",
    });

    expect(deleteWhere).toHaveBeenCalledWith(expect.objectContaining({ op: "eq" }));
    expect(tx.insert).not.toHaveBeenCalled();
    expect(set).toHaveBeenLastCalledWith({
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
      ragReason: "unsupported_type",
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    });
    expect(mocks.gt).toHaveBeenCalledWith(
      schema.fileObjects.processingLeaseExpiresAt,
      expect.objectContaining({ text: "statement_timestamp()" }),
    );
  });

  it("最终 freshness gate zero-row 时拒绝完成", async () => {
    const forUpdate = vi.fn().mockResolvedValue([{ id: "file-1" }]);
    const limit = vi.fn(() => ({ for: forUpdate }));
    const selectWhere = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from }));
    const set = vi
      .fn()
      .mockReturnValueOnce({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "file-1" }]) })),
      })
      .mockReturnValueOnce({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
      });
    const tx = {
      select,
      update: vi.fn(() => ({ set })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    };
    mocks.getDb.mockResolvedValue({
      transaction: vi.fn(async (callback) => callback(tx)),
    });

    await expect(replaceFileChunksAndComplete(lease, {
      chunks: [],
      ragReady: false,
      ragReason: "embedding_unavailable",
    })).rejects.toBeInstanceOf(FileProcessingLeaseLostError);
  });
});
