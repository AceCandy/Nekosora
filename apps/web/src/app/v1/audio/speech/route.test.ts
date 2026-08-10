import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  synthesizeViaRoute: vi.fn(),
  logUsage: vi.fn(),
  beginGatewayGovernance: vi.fn(),
  reserveQuota: vi.fn(),
  markProviderStarted: vi.fn(),
  finalize: vi.fn(),
  governanceSignal: new AbortController().signal,
}));

vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/providers/multimodal/audio-tts", () => ({
  RoutingError: class RoutingError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  synthesizeViaRoute: mocks.synthesizeViaRoute,
}));
vi.mock("@/lib/usage", () => ({ logUsage: mocks.logUsage }));
vi.mock("@/lib/gateway-governance/lifecycle", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-governance/lifecycle")>(),
  beginGatewayGovernance: mocks.beginGatewayGovernance,
}));

import { GovernanceStateError } from "@/lib/gateway-governance/repository";
import { POST } from "@/app/v1/audio/speech/route";

function request(body: Record<string, unknown>, language = "en") {
  return new NextRequest("http://localhost/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: "Bearer sk-test",
      "accept-language": language,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/audio/speech", () => {
  beforeEach(() => {
    mocks.extractBearer.mockReset().mockReturnValue("sk-test");
    mocks.verifyKey.mockReset().mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "key-1", keyKind: "master", source: "gateway" },
    });
    mocks.synthesizeViaRoute.mockReset().mockResolvedValue({
      audioBuffer: Buffer.from([1, 2, 3]),
      mime: "audio/mpeg",
      providerRef: "provider-1",
      providerName: "provider",
      routeId: "route-1",
      routeName: "route",
      upstreamModel: "tts-1",
      upstreamKeyMasked: "sk-***",
    });
    mocks.logUsage.mockReset().mockResolvedValue(undefined);
    mocks.reserveQuota.mockReset().mockResolvedValue(undefined);
    mocks.markProviderStarted.mockReset().mockResolvedValue(undefined);
    mocks.finalize.mockReset().mockResolvedValue({ settled: true });
    mocks.beginGatewayGovernance.mockReset().mockResolvedValue({
      signal: mocks.governanceSignal,
      reserveQuota: mocks.reserveQuota,
      markProviderStarted: mocks.markProviderStarted,
      finalize: mocks.finalize,
    });
  });

  it("合法请求保持 OpenAI 字段透传和音频响应", async () => {
    const req = request({
      model: "tts-1",
      input: "hello",
      voice: "alloy",
      response_format: "mp3",
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe("3");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(mocks.synthesizeViaRoute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "tts-1",
      expect.objectContaining({
        text: "hello",
        voice: "alloy",
        outputFormat: "mp3",
        abortSignal: mocks.governanceSignal,
        onProviderStart: expect.any(Function),
      }),
    );
    expect(mocks.beginGatewayGovernance).toHaveBeenCalledWith({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "audio.speech",
      requestSignal: req.signal,
    });
    expect(mocks.reserveQuota).toHaveBeenCalledWith("tts_code_points", 5);
    const options = mocks.synthesizeViaRoute.mock.calls[0]?.[2];
    await options.onProviderStart();
    expect(mocks.markProviderStarted).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledWith(5);
  });

  it("TTS 上限按 Unicode code point 计算", async () => {
    const accepted = await POST(request({ model: "tts-1", input: "😀".repeat(4096) }));

    expect(accepted.status).toBe(200);
    expect(mocks.reserveQuota).toHaveBeenCalledWith("tts_code_points", 4096);
    expect(mocks.finalize).toHaveBeenCalledWith(4096);

    mocks.reserveQuota.mockClear();
    mocks.finalize.mockClear();
    const rejected = await POST(request({ model: "tts-1", input: "😀".repeat(4097) }));

    expect(rejected.status).toBe(400);
    expect(mocks.reserveQuota).not.toHaveBeenCalled();
    expect(mocks.synthesizeViaRoute).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledWith(undefined);
  });

  it("Provider-start 治理失败保持 503", async () => {
    mocks.markProviderStarted.mockRejectedValueOnce(new GovernanceStateError());
    mocks.synthesizeViaRoute.mockImplementationOnce(async (_ctx, _model, options) => {
      await options.onProviderStart();
      throw new Error("unreachable");
    });

    const response = await POST(request({ model: "tts-1", input: "hello" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "server.service_unavailable" },
    });
    expect(mocks.finalize).toHaveBeenCalledWith(undefined);
  });

  it("缺失 input 时返回 OpenAI 风格本地化错误且不调用上游", async () => {
    const response = await POST(request({ model: "tts-1", voice: "alloy" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "request.missing_field",
        type: "invalid_request_error",
      },
    });
    expect(mocks.synthesizeViaRoute).not.toHaveBeenCalled();
  });

  it("上游错误 envelope、console 与日志不暴露凭据", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.synthesizeViaRoute.mockRejectedValue(
      new Error("upstream failed Authorization: Bearer ROUTE_SECRET"),
    );

    const response = await POST(request({ model: "tts-1", input: "hello", voice: "alloy" }));
    const body = await response.json();

    expect(body).toMatchObject({
      error: { code: "media.tts_failed", type: "server_error" },
    });
    expect(JSON.stringify(body)).not.toContain("ROUTE_SECRET");
    expect(mocks.logUsage).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("ROUTE_SECRET");
    consoleSpy.mockRestore();
  });
});
