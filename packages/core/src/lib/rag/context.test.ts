import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  retrieve: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/rag/retrieve", () => ({ retrieve: mocks.retrieve }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq, inArray: mocks.inArray, and: mocks.and }));

import { buildMessagesWithFileContext } from "@/lib/rag/context";

const schema = {
  fileObjects: { id: "files.id", userId: "files.userId" },
  fileChunks: { fileId: "chunks.fileId" },
};

describe("文件上下文属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
    mocks.retrieve.mockResolvedValue({
      chunks: [],
      status: "rag_empty",
      candidateCount: 0,
      maxScore: 0,
      cached: false,
    });
  });

  it("只向 retrieve 传递 owner 查询命中的文件 ID", async () => {
    const where = vi.fn().mockResolvedValue([{
      id: "owned-file",
      filename: "owned.txt",
      mime: "text/plain",
    }]);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    const result = await buildMessagesWithFileContext({
      userId: "user-1",
      messages: [{ role: "user", content: "question" }],
      fileIds: ["owned-file", "other-file"],
      fileMode: "rag",
      query: "question",
    });

    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.userId, "user-1");
    expect(mocks.retrieve).toHaveBeenCalledWith(
      "question",
      ["owned-file"],
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(result.sources).toEqual([]);
  });

  it("全文模式只返回真正加入预算的非空文件", async () => {
    const where = vi.fn()
      .mockResolvedValueOnce([
        { id: "empty", filename: "empty.txt", mime: "text/plain" },
        { id: "included", filename: "included.txt", mime: "text/plain" },
        { id: "overflow", filename: "overflow.txt", mime: "text/plain" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ chunkIndex: 0, content: "a".repeat(16_000) }])
      .mockResolvedValueOnce([{ chunkIndex: 0, content: "later" }]);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    const result = await buildMessagesWithFileContext({
      userId: "user-1",
      messages: [{ role: "user", content: "question" }],
      fileIds: ["empty", "included", "overflow"],
      fileMode: "full_context",
      query: "question",
    });

    expect(result.sources).toEqual([{
      fileId: "included",
      filename: "included.txt",
      mime: "text/plain",
    }]);
    expect(JSON.stringify(result)).not.toContain("overflow.txt");
  });

  it("向量模式按最终命中文件去重并使用属主文件元数据", async () => {
    const where = vi.fn().mockResolvedValue([
      { id: "file-1", filename: "canonical.txt", mime: "text/plain" },
    ]);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });
    mocks.retrieve.mockResolvedValue({
      status: "rag_hit",
      candidateCount: 3,
      maxScore: 0.9,
      cached: false,
      chunks: [
        { fileId: "file-1", filename: "stale.txt", chunkIndex: 1, content: "one", similarity: 0.9 },
        { fileId: "file-1", filename: "stale.txt", chunkIndex: 2, content: "two", similarity: 0.8 },
        { fileId: "missing", filename: "missing.txt", chunkIndex: 0, content: "hidden", similarity: 0.7 },
      ],
    });

    const result = await buildMessagesWithFileContext({
      userId: "user-1",
      messages: [{ role: "user", content: "question" }],
      fileIds: ["file-1"],
      fileMode: "rag",
      query: "question",
    });

    expect(result.sources).toEqual([{
      fileId: "file-1",
      filename: "canonical.txt",
      mime: "text/plain",
    }]);
    expect(result.messages[0]?.content).toContain("one");
    expect(result.messages[0]?.content).toContain("two");
    expect(JSON.stringify(result.sources)).not.toMatch(/chunkIndex|similarity|content|missing/);
  });
});
