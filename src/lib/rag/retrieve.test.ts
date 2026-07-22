import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  embedText: vi.fn(),
  estimateTokens: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/rag/embedding", () => ({ embedText: mocks.embedText }));
vi.mock("@/lib/tokens", () => ({ estimateTokens: mocks.estimateTokens }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq, inArray: mocks.inArray, and: mocks.and }));

import { retrieve } from "@/lib/rag/retrieve";

const schema = {
  fileChunks: { fileId: "chunks.fileId" },
  fileObjects: {
    id: "files.id",
    userId: "files.userId",
    ragReady: "files.ragReady",
  },
};

describe("retrieve 文件属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.embedText.mockResolvedValue([1, 0]);
    mocks.estimateTokens.mockReturnValue(1);
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
  });

  it.each([{ fileIds: ["file-1"] }, { fileIds: [] }])(
    "fileIds=$fileIds 时始终限制 owner 与 ragReady",
    async ({ fileIds }) => {
      const where = vi.fn().mockResolvedValue([]);
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({ where })),
          })),
        })),
      };
      mocks.getDb.mockResolvedValue(db);

      await retrieve("query", fileIds, {
        userId: "user-1",
        timeoutMs: 50,
      });

      expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.userId, "user-1");
      expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.ragReady, true);
      expect(where).toHaveBeenCalledWith(mocks.and.mock.results.at(-1)?.value);
      if (fileIds.length > 0) {
        expect(mocks.inArray).toHaveBeenCalledWith(schema.fileChunks.fileId, fileIds);
      }
    },
  );
});
