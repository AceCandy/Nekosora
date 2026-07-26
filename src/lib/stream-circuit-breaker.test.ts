import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { json: vi.fn(() => ({ kind: "json-output" })) },
}));

const mocks = vi.hoisted(() => ({
  logUsage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>("@/lib/usage");
  return {
    ...actual,
    logUsage: (...args: unknown[]) => mocks.logUsage(...args),
  };
});

import { generateText, streamText } from "ai";
import { generateChat, streamChat } from "@/lib/stream";
import {
  resetRouteRepository,
  setRouteRepository,
  type RouteRepository,
} from "@/lib/repositories/route-repository";
import { encrypt } from "@/lib/infra/crypto";
import { resetAllBreakers, snapshotBreakers } from "@/lib/circuit-breaker";

let encryptedKeys = "";

function makeSingleRouteRepository(): RouteRepository {
  return {
    findEnabledModelById: async (id) => id === "model-a" ? ({
      id: "model-a",
      name: "test-model",
      ownerUserId: "user-a",
      visibility: "public",
      enabled: true,
      capabilities: {},
    }) : null,
    findEnabledModelByNameForOwner: async () => ({
      id: "model-a",
      name: "test-model",
      ownerUserId: "user-a",
      visibility: "private",
      enabled: true,
      capabilities: {},
    }),
    findEnabledRoutes: async () => [{
      route: {
        id: "route-a",
        modelId: "model-a",
        providerId: "provider-a",
        upstreamModelName: "upstream-model",
        priority: 0,
        weight: 1,
        enabled: true,
      },
      provider: {
        id: "provider-a",
        name: "Provider A",
        protocol: "openai",
        baseUrl: "https://example.com/v1",
        apiKeysEnc: encryptedKeys,
        headersJson: { "x-custom-auth": "HEADER_SECRET" },
        enabled: true,
      },
    }],
    findEnabledProvider: async () => null,
    findKeyModelBindings: async () => ({ modelIds: new Set() }),
  };
}

describe("chat generation circuit breaker reporting", () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    encryptedKeys = encrypt(JSON.stringify({ keys: [{ key: "sk-test-fake", weight: 1 }] }));
  });

  beforeEach(() => {
    resetAllBreakers();
    setRouteRepository(makeSingleRouteRepository());
    vi.mocked(generateText).mockReset();
    vi.mocked(streamText).mockReset();
    mocks.logUsage.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetRouteRepository();
    resetAllBreakers();
    vi.restoreAllMocks();
  });

  it("唯一路由发生可转移错误时仍记录 provider 失败", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("connect ETIMEDOUT"));

    const result = await generateChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    });

    expect(result.error).toBe("connect ETIMEDOUT");
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 1,
    });
  });

  it("唯一路由发生确定性请求错误时不记录 provider 失败", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("invalid_request_error"));

    const result = await generateChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    });

    expect(result.error).toBe("invalid_request_error");
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 0,
    });
  });

  it("generateChat 对外结果与尝试日志不包含实际 key/header,分类保持原始状态码", async () => {
    const error = Object.assign(
      new Error("upstream failed for sk-test-fake and HEADER_SECRET"),
      { statusCode: 401 },
    );
    vi.mocked(generateText).mockRejectedValue(error);

    const result = await generateChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    });

    expect(result.error).toBe("upstream failed for [REDACTED] and [REDACTED]");
    expect(mocks.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "auth_error",
        httpStatus: 401,
        errorMessage: "upstream failed for [REDACTED] and [REDACTED]",
      }),
    );
  });

  it("key 重试 console 只输出安全消息", async () => {
    const originalEncryptedKeys = encryptedKeys;
    encryptedKeys = encrypt(JSON.stringify({
      keys: [
        { key: "sk-first-fake", weight: 1 },
        { key: "sk-second-fake", weight: 1 },
      ],
    }));
    setRouteRepository(makeSingleRouteRepository());
    vi.mocked(streamText).mockImplementation(() => ({
      stream: (async function* () {
        yield {
          type: "error",
          error: Object.assign(
            new Error("Authorization: Bearer sk-first-fake x-api-key=HEADER_SECRET"),
            { statusCode: 401 },
          ),
        };
      })(),
    }) as never);

    try {
      for await (const _event of streamChat({
        ctx: { userId: "user-a", keyKind: null, source: "chat" },
        request: {
          model: "test-model",
          messages: [{ role: "user", content: "hello" }],
        },
        userAgent: "Nekusora-Test",
      })) {
        // Consume the stream so the retry path reaches its console sink.
      }

      const output = JSON.stringify(vi.mocked(console.warn).mock.calls);
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain("sk-first-fake");
      expect(output).not.toContain("HEADER_SECRET");
    } finally {
      encryptedKeys = originalEncryptedKeys;
    }
  });

  it("generateChat 传 modelId 时走 byId 路由并映射 JSON output", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '{"memory":[]}',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    } as never);

    const result = await generateChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      modelId: "model-a",
      output: "json",
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    });

    expect(result.text).toBe('{"memory":[]}');
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      output: { kind: "json-output" },
    }));
  });

  it("流式唯一路由发生可转移错误时仍记录 provider 失败", async () => {
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield { type: "error", error: new Error("connect ETIMEDOUT") };
      })(),
    } as never);

    const events = [];
    for await (const event of streamChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: "connect ETIMEDOUT",
    });
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 1,
    });
  });

  it("streamChat 错误事件与尝试日志不包含实际 key/header", async () => {
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield {
          type: "error",
          error: new Error("connect ETIMEDOUT for sk-test-fake and HEADER_SECRET"),
        };
      })(),
    } as never);

    const events = [];
    for await (const event of streamChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: "connect ETIMEDOUT for [REDACTED] and [REDACTED]",
    });
    expect(mocks.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "network_error",
        errorMessage: "connect ETIMEDOUT for [REDACTED] and [REDACTED]",
      }),
    );
  });

  it("流式唯一路由发生确定性请求错误时不记录 provider 失败", async () => {
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield { type: "error", error: new Error("invalid_request_error") };
      })(),
    } as never);

    for await (const _event of streamChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
    })) {
      // Consume the public stream so failure reporting and cleanup complete.
    }

    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 0,
    });
  });
});
