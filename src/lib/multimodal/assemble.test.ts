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

  it("配置公共产物 URL 时仍通过临时签名 URL 传递图片", async () => {
    const get = vi.fn();
    const signedUrl = vi.fn().mockResolvedValue(
      "https://s3.example.com/user-1/image.png?X-Amz-Signature=signed",
    );
    const where = vi.fn().mockResolvedValue([
      { mime: "image/png", storagePath: "user-1/image.png" },
    ]);
    mocks.getStorage.mockResolvedValue({ publicReadable: true, get, signedUrl });
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    });

    const message = await buildMultimodalUserMessage(
      "question",
      ["owned-file"],
      "user-1",
    );

    expect(signedUrl).toHaveBeenCalledWith("user-1/image.png", 3600);
    expect(get).not.toHaveBeenCalled();
    expect(message.content).toEqual([
      { type: "text", text: "question" },
      {
        type: "image_url",
        image_url: {
          url: "https://s3.example.com/user-1/image.png?X-Amz-Signature=signed",
        },
      },
    ]);
  });
});
