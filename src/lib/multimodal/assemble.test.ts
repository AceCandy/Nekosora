import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq, inArray: mocks.inArray, and: mocks.and }));

import { buildMultimodalUserMessage } from "@/lib/multimodal/assemble";

const schema = {
  fileObjects: { id: "files.id", userId: "files.userId" },
};

describe("多模态文件属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.inArray.mockImplementation((left, values) => ({ op: "inArray", left, values }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
  });

  it("owner 查询无结果时不读取 storage", async () => {
    const get = vi.fn();
    const signedUrl = vi.fn();
    const where = vi.fn().mockResolvedValue([]);
    mocks.getStorage.mockResolvedValue({ publicReadable: false, get, signedUrl });
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    const message = await buildMultimodalUserMessage(
      "question",
      ["other-file"],
      "user-1",
    );

    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.userId, "user-1");
    expect(where).toHaveBeenCalledWith(mocks.and.mock.results.at(-1)?.value);
    expect(get).not.toHaveBeenCalled();
    expect(signedUrl).not.toHaveBeenCalled();
    expect(message.content).toEqual([{ type: "text", text: "question" }]);
  });
});
