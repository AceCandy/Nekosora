import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStorage: vi.fn(),
}));

vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));

import { buildMultimodalUserMessage } from "@/lib/multimodal/assemble";

describe("多模态图片组装", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无图片时不读取 storage", async () => {
    const get = vi.fn();
    const signedUrl = vi.fn();
    mocks.getStorage.mockResolvedValue({ publicReadable: false, get, signedUrl });

    const message = await buildMultimodalUserMessage(
      "question",
      [],
    );

    expect(mocks.getStorage).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(signedUrl).not.toHaveBeenCalled();
    expect(message.content).toBe("question");
  });

  it("配置公共产物 URL 时仍通过临时签名 URL 传递图片", async () => {
    const get = vi.fn();
    const signedUrl = vi.fn().mockResolvedValue(
      "https://s3.example.com/user-1/image.png?X-Amz-Signature=signed",
    );
    mocks.getStorage.mockResolvedValue({ publicReadable: true, get, signedUrl });

    const message = await buildMultimodalUserMessage(
      "question",
      [{
        fileId: "owned-file",
        filename: "image.png",
        mime: "image/png",
        storagePath: "user-1/image.png",
      }],
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
