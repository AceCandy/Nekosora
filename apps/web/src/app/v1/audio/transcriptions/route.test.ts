import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  extractBearer: vi.fn(),
  verifyKey: vi.fn(),
  parseFormData: vi.fn(),
  transcribeViaRoute: vi.fn(),
  logUsage: vi.fn(),
  beginGatewayGovernance: vi.fn(),
  reserveQuota: vi.fn(),
  markProviderStarted: vi.fn(),
  finalize: vi.fn(),
  measureSttSeconds: vi.fn(),
  governanceSignal: new AbortController().signal,
}));

vi.mock("@/lib/keys", () => ({
  extractBearer: mocks.extractBearer,
  verifyKey: mocks.verifyKey,
}));
vi.mock("@/lib/multipart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/multipart")>();
  return { ...actual, parseBoundedMultipartFormData: mocks.parseFormData };
});
vi.mock("@/lib/providers/multimodal/audio-stt", () => ({
  RoutingError: class RoutingError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  transcribeViaRoute: mocks.transcribeViaRoute,
}));
vi.mock("@/lib/usage", () => ({ logUsage: mocks.logUsage }));
vi.mock("@/lib/gateway-governance/lifecycle", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-governance/lifecycle")>(),
  beginGatewayGovernance: mocks.beginGatewayGovernance,
}));
vi.mock("@/lib/gateway-governance/metering", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-governance/metering")>(),
  measureSttSeconds: mocks.measureSttSeconds,
}));

import { RequestBodyTooLargeError } from "@/lib/multipart";
import { RoutingError } from "@/lib/providers/multimodal/audio-stt";
import {
  MAX_TRANSCRIPTION_BODY_BYTES,
  MAX_TRANSCRIPTION_FILE_BYTES,
} from "@/app/v1/audio/transcriptions/transcription-limits";
import { POST } from "@/app/v1/audio/transcriptions/route";

function request(language = "en") {
  return new NextRequest("http://localhost/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      authorization: "Bearer sk-test",
      "accept-language": language,
    },
  });
}

function transcriptionForm(size = 5): FormData {
  const formData = new FormData();
  const file = new File(["audio"], "sample.mp3", { type: "audio/mpeg" });
  Object.defineProperty(file, "size", { value: size });
  formData.set("model", "whisper-1");
  formData.set("file", file);
  formData.set("language", "zh");
  formData.set("prompt", "context");
  return formData;
}

describe("POST /v1/audio/transcriptions", () => {
  beforeEach(() => {
    mocks.extractBearer.mockReset().mockReturnValue("sk-test");
    mocks.verifyKey.mockReset().mockResolvedValue({
      ctx: { userId: "user-1", apiKeyId: "key-1", keyKind: "main", source: "gateway" },
    });
    mocks.parseFormData.mockReset().mockResolvedValue(transcriptionForm());
    mocks.transcribeViaRoute.mockReset().mockResolvedValue({
      text: "transcribed",
      providerRef: "provider-1",
      providerName: "provider",
      routeId: "route-1",
      routeName: "route",
      upstreamModel: "whisper-1",
      upstreamKeyMasked: "sk-***",
    });
    mocks.logUsage.mockReset().mockResolvedValue(undefined);
    mocks.reserveQuota.mockReset().mockResolvedValue(undefined);
    mocks.markProviderStarted.mockReset().mockResolvedValue(undefined);
    mocks.finalize.mockReset().mockResolvedValue({ settled: true });
    mocks.measureSttSeconds.mockReset().mockResolvedValue(6);
    mocks.beginGatewayGovernance.mockReset().mockResolvedValue({
      signal: mocks.governanceSignal,
      reserveQuota: mocks.reserveQuota,
      markProviderStarted: mocks.markProviderStarted,
      finalize: mocks.finalize,
    });
  });

  it("multipart 总体超限时返回本地化 413 且不调用上游", async () => {
    mocks.parseFormData.mockRejectedValue(
      new RequestBodyTooLargeError(MAX_TRANSCRIPTION_BODY_BYTES),
    );
    const req = request("en");

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({
      error: {
        code: "request.payload_too_large",
        type: "invalid_request_error",
        message: "Request payload is too large",
      },
    });
    expect(mocks.parseFormData).toHaveBeenCalledWith(
      req,
      MAX_TRANSCRIPTION_BODY_BYTES,
    );
    expect(mocks.transcribeViaRoute).not.toHaveBeenCalled();
  });

  it("实际音频文件超限时返回 413 且不调用上游", async () => {
    mocks.parseFormData.mockResolvedValue(
      transcriptionForm(MAX_TRANSCRIPTION_FILE_BYTES + 1),
    );

    const response = await POST(request());

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "request.payload_too_large" },
    });
    expect(mocks.transcribeViaRoute).not.toHaveBeenCalled();
  });

  it("合法音频保持字段透传与转写响应", async () => {
    const req = request();
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "transcribed" });
    expect(mocks.beginGatewayGovernance).toHaveBeenCalledWith({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "audio.transcription",
      requestSignal: req.signal,
    });
    expect(mocks.measureSttSeconds).toHaveBeenCalledWith(
      Buffer.from("audio"),
      "audio/mpeg",
    );
    expect(mocks.reserveQuota).toHaveBeenCalledWith("stt_seconds", 6);
    expect(mocks.transcribeViaRoute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "whisper-1",
      expect.objectContaining({
        audio: Buffer.from("audio"),
        mime: "audio/mpeg",
        language: "zh",
        prompt: "context",
        abortSignal: mocks.governanceSignal,
        onProviderStart: expect.any(Function),
      }),
    );
    const options = mocks.transcribeViaRoute.mock.calls[0]?.[2];
    await options.onProviderStart();
    expect(mocks.markProviderStarted).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledWith(6);
  });

  it("无法可靠计量的音频在 Provider 前拒绝", async () => {
    mocks.measureSttSeconds.mockRejectedValueOnce(new Error("invalid audio"));

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "request.invalid_json" },
    });
    expect(mocks.reserveQuota).not.toHaveBeenCalled();
    expect(mocks.transcribeViaRoute).not.toHaveBeenCalled();
    expect(mocks.finalize).toHaveBeenCalledWith(undefined);
  });

  it("无健康路由时保留 routing.no_healthy_route 和 503", async () => {
    mocks.transcribeViaRoute.mockRejectedValueOnce(new RoutingError("no_healthy_route"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "routing.no_healthy_route", type: "server_error" },
    });
  });

  it("异常兜底不会把凭据写入 HTTP、console 或错误日志", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.transcribeViaRoute.mockRejectedValue(
      new Error("upstream failed Authorization: Bearer ROUTE_SECRET"),
    );

    const response = await POST(request());
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain("ROUTE_SECRET");
    expect(JSON.stringify(body)).toContain("[REDACTED]");
    expect(mocks.logUsage).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("ROUTE_SECRET");
    consoleSpy.mockRestore();
  });
});
