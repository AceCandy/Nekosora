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
    const where = vi.fn().mockResolvedValue([{ id: "owned-file", filename: "owned.txt" }]);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    await buildMessagesWithFileContext({
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
  });
});
