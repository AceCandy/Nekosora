import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import type { CallContext, IRRequest } from "@/lib/providers/types";
import { handleProtocolRequest } from "./handler";
import { GatewayRequestError, UnsupportedParameterError } from "./validation";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  logUsage: vi.fn(),
  nonStreamResponse: vi.fn(),
  streamResponse: vi.fn(),
}));

vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("@/lib/usage", () => ({ logUsage: mocks.logUsage }));
vi.mock("./encoders", async (importOriginal) => ({
  ...await importOriginal<typeof import("./encoders")>(),
  nonStreamProtocolResponse: mocks.nonStreamResponse,
  streamProtocolResponse: mocks.streamResponse,
}));

const ctx: CallContext = {
  userId: "user-1",
  apiKeyId: "key-1",
  keyKind: "master",
  source: "gateway",
};

const parsedRequest: IRRequest = {
  model: "demo",
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
};

function request(body = "{}") {
  return new Request("http://gateway.test/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("handleProtocolRequest boundary telemetry", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset().mockResolvedValue(ctx);
    mocks.logUsage.mockReset().mockResolvedValue(undefined);
    mocks.nonStreamResponse.mockReset().mockResolvedValue(Response.json({ ok: true }));
    mocks.streamResponse.mockReset().mockReturnValue(Response.json({ ok: true }));
  });

  it.each([
    [ErrorCode.AUTH_MISSING_KEY, "Missing API key"],
    [ErrorCode.AUTH_INVALID_KEY, "Invalid API key"],
  ] as const)("鉴权失败 %s 写一条 engine 外 execution", async (code, message) => {
    mocks.authenticate.mockRejectedValueOnce(new GatewayRequestError(code, message));

    const response = await handleProtocolRequest(
      request(),
      "openai-responses",
      "/v1/responses",
      vi.fn(),
    );

    expect(response.status).toBe(401);
    expect(mocks.logUsage).toHaveBeenCalledOnce();
    expect(mocks.logUsage).toHaveBeenCalledWith(expect.objectContaining({
      ctx: { userId: "", apiKeyId: null, keyKind: null, source: "gateway" },
      status: "failed",
      errorCode: code,
      httpStatus: 401,
      requestPath: "/v1/responses",
      errorPhase: "auth",
    }));
  });

  it("非法 JSON 使用已鉴权身份写 request 失败", async () => {
    const parse = vi.fn();

    const response = await handleProtocolRequest(
      request("{"),
      "openai-responses",
      "/v1/responses",
      parse,
    );

    expect(response.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.logUsage).toHaveBeenCalledWith(expect.objectContaining({
      ctx,
      errorCode: ErrorCode.REQUEST_INVALID_JSON,
      httpStatus: 400,
      requestPath: "/v1/responses",
      errorPhase: "request",
    }));
  });

  it("parser 的 unsupported parameter 在触网前写准确错误", async () => {
    const response = await handleProtocolRequest(
      request(),
      "openai-responses",
      "/v1/responses",
      () => { throw new UnsupportedParameterError("store"); },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: ErrorCode.REQUEST_UNSUPPORTED_PARAMETER,
        param: "store",
        message: "Unsupported parameter: 'store'.",
      },
    });
    expect(mocks.logUsage).toHaveBeenCalledWith(expect.objectContaining({
      ctx,
      errorCode: ErrorCode.REQUEST_UNSUPPORTED_PARAMETER,
      errorMessage: "Unsupported parameter: 'store'.",
      errorPhase: "request",
    }));
  });

  it("parser 成功后 encoder/engine 失败不重复写 route telemetry", async () => {
    mocks.nonStreamResponse.mockRejectedValueOnce(new Error("engine-owned failure"));

    await expect(handleProtocolRequest(
      request(),
      "openai-responses",
      "/v1/responses",
      () => ({ request: parsedRequest, stream: false }),
    )).rejects.toThrow("engine-owned failure");

    expect(mocks.logUsage).not.toHaveBeenCalled();
  });
});
