import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  generateImageViaRoute: vi.fn(),
  getStorage: vi.fn(),
  logUsage: vi.fn(),
}));

vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/providers/multimodal/image-gen", () => ({
  RoutingError: class RoutingError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  generateImageViaRoute: mocks.generateImageViaRoute,
}));
vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@/lib/usage", () => ({ logUsage: mocks.logUsage }));

import { POST } from "@/app/v1/images/generations/route";

function request(body: Record<string, unknown>, language = "en") {
  return new NextRequest("http://localhost/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: "Bearer sk-test",
      "accept-language": language,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/images/generations", () => {
  beforeEach(() => {
    mocks.extractBearer.mockReset().mockReturnValue("sk-test");
    mocks.verifyKey.mockReset().mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "key-1", keyKind: "master", source: "gateway" },
    });
    mocks.generateImageViaRoute.mockReset().mockResolvedValue({
      images: [{ base64: "ZmFrZQ==", revisedPrompt: "revised" }],
      providerRef: "provider-1",
      providerName: "provider",
      routeId: "route-1",
      routeName: "route",
      upstreamModel: "image-1",
      upstreamKeyMasked: "sk-***",
    });
    mocks.getStorage.mockReset();
    mocks.logUsage.mockReset().mockResolvedValue(undefined);
  });

  it("b64_json 保持 OpenAI Images 请求和响应字段", async () => {
    const response = await POST(request({
      model: "image-1",
      prompt: "a cat",
      n: 2,
      size: "1024x1024",
      response_format: "b64_json",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      created: expect.any(Number),
      data: [{ b64_json: "ZmFrZQ==", revised_prompt: "revised" }],
    });
    expect(mocks.generateImageViaRoute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "image-1",
      {
        prompt: "a cat",
        n: 2,
        size: "1024x1024",
        responseFormat: "b64_json",
      },
    );
  });

  it("缺失 prompt 时返回 OpenAI 风格本地化错误且不调用上游", async () => {
    const response = await POST(request({ model: "image-1" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "request.missing_field",
        type: "invalid_request_error",
      },
    });
    expect(mocks.generateImageViaRoute).not.toHaveBeenCalled();
  });

  it("上游错误 envelope、console 与日志不暴露凭据", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.generateImageViaRoute.mockRejectedValue(
      new Error("upstream failed Authorization: Bearer ROUTE_SECRET"),
    );

    const response = await POST(request({ model: "image-1", prompt: "a cat" }));
    const body = await response.json();

    expect(body).toMatchObject({
      error: { code: "media.image_gen_failed", type: "server_error" },
    });
    expect(JSON.stringify(body)).not.toContain("ROUTE_SECRET");
    expect(mocks.logUsage).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("ROUTE_SECRET");
    consoleSpy.mockRestore();
  });
});
