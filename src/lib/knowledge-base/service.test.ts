import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/infra/cache", () => ({ cacheWrap: vi.fn(), cacheDel: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq, inArray: mocks.inArray, and: mocks.and }));

import { getFileIdsByKnowledgeBases } from "@/lib/knowledge-base/service";

const schema = {
  fileObjects: {
    id: "files.id",
    knowledgeBaseId: "files.knowledgeBaseId",
    userId: "files.userId",
    ragReady: "files.ragReady",
  },
};

describe("知识库文件属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
  });

  it("按知识库、owner 与 ragReady 共同过滤", async () => {
    const where = vi.fn().mockResolvedValue([{ id: "owned-file" }]);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    await expect(
      getFileIdsByKnowledgeBases(["kb-1"], "user-1"),
    ).resolves.toEqual(["owned-file"]);

    expect(mocks.inArray).toHaveBeenCalledWith(schema.fileObjects.knowledgeBaseId, ["kb-1"]);
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.userId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.ragReady, true);
    expect(where).toHaveBeenCalledWith(mocks.and.mock.results.at(-1)?.value);
  });
});
