import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import type { CallContext } from "@/lib/providers/types";
import { authenticateGatewayRequest } from "./auth";
import type { GatewayProtocol } from "./types";
import { GatewayRequestError, UnsupportedParameterError } from "./validation";

const verifyKey = vi.hoisted(() => vi.fn());

vi.mock("@/lib/keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/keys")>();
  return { ...actual, verifyKey };
});

const ctx: CallContext = {
  userId: "user-1",
  apiKeyId: "key-1",
  keyKind: "master",
  source: "gateway",
};

function request(headers?: HeadersInit, query = "") {
  return new Request(`http://gateway.test/v1/test${query}`, { headers });
}

describe("authenticateGatewayRequest", () => {
  beforeEach(() => {
    verifyKey.mockReset();
    verifyKey.mockResolvedValue({ ctx, record: {} });
  });

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s 接受 Bearer", async (protocol) => {
    await expect(authenticateGatewayRequest(
      request({ authorization: "Bearer sk-bearer" }),
      protocol,
    )).resolves.toEqual(ctx);
    expect(verifyKey).toHaveBeenCalledWith("sk-bearer");
  });

  it.each([
    ["anthropic", "x-api-key"],
    ["gemini", "x-goog-api-key"],
  ] as const)("%s 接受原生 Key 头", async (protocol, header) => {
    await expect(authenticateGatewayRequest(
      request({ [header]: "  sk-native  " }),
      protocol,
    )).resolves.toEqual(ctx);
    expect(verifyKey).toHaveBeenCalledWith("sk-native");
  });

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s 缺少 Key 时拒绝", async (protocol) => {
    await expect(authenticateGatewayRequest(request(), protocol)).rejects.toMatchObject({
      code: ErrorCode.AUTH_MISSING_KEY,
    } satisfies Partial<GatewayRequestError>);
    expect(verifyKey).not.toHaveBeenCalled();
  });

  it.each([
    ["openai-chat", { authorization: "Bearer sk-invalid" }],
    ["openai-responses", { authorization: "Bearer sk-invalid" }],
    ["anthropic", { "x-api-key": "sk-invalid" }],
    ["gemini", { "x-goog-api-key": "sk-invalid" }],
  ] as const)("%s 的无效 Key 被拒绝", async (protocol, headers) => {
    verifyKey.mockResolvedValueOnce(null);
    await expect(authenticateGatewayRequest(request(headers), protocol)).rejects.toMatchObject({
      code: ErrorCode.AUTH_INVALID_KEY,
    } satisfies Partial<GatewayRequestError>);
  });

  it.each([
    ["anthropic", "x-api-key"],
    ["gemini", "x-goog-api-key"],
  ] as const)("%s 的冲突 Key 被拒绝，同值 Key 被接受", async (protocol, header) => {
    await expect(authenticateGatewayRequest(request({
      authorization: "Bearer sk-bearer",
      [header]: "sk-native",
    }), protocol)).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_KEY });
    expect(verifyKey).not.toHaveBeenCalled();

    await expect(authenticateGatewayRequest(request({
      authorization: "Bearer sk-same",
      [header]: "sk-same",
    }), protocol)).resolves.toEqual(ctx);
    expect(verifyKey).toHaveBeenCalledWith("sk-same");
  });

  it("Gemini query key 在验 Key 和日志前拒绝且不泄漏明文", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "query-secret-must-not-leak";

    try {
      await authenticateGatewayRequest(
        request({ "x-goog-api-key": "sk-header" }, `?key=${secret}`),
        "gemini",
      );
      throw new Error("预期拒绝 Gemini query key");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedParameterError);
      expect(error).toMatchObject({
        code: ErrorCode.REQUEST_UNSUPPORTED_PARAMETER,
        parameter: "key",
        message: "Unsupported parameter: 'key'.",
        details: { parameter: "key" },
      });
      expect((error as Error).message).not.toContain(secret);
    }

    expect(verifyKey).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
