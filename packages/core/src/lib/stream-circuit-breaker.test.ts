import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { json: vi.fn(() => ({ kind: "json-output" })) },
}));

const mocks = vi.hoisted(() => ({
  logUsage: vi.fn(async () => undefined),
  startExecution: vi.fn(async () => undefined),
  recordAttempt: vi.fn(async () => undefined),
  finalizeExecution: vi.fn(async () => undefined),
  markProviderStreamUsageUnsupported: vi.fn(async () => undefined),
}));

vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>("@/lib/usage");
  return {
    ...actual,
    logUsage: (...args: unknown[]) => mocks.logUsage(...args),
  };
});
vi.mock("@/lib/gateway-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gateway-execution")>();
  return {
    ...actual,
    gatewayTelemetry: {
      startExecution: mocks.startExecution,
      recordAttempt: mocks.recordAttempt,
      finalizeExecution: mocks.finalizeExecution,
    },
  };
});
vi.mock("@/lib/repositories/route-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/route-repository")>();
  return {
    ...actual,
    markProviderStreamUsageUnsupported: mocks.markProviderStreamUsageUnsupported,
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

function makeTwoRouteRepository(): RouteRepository {
  const repository = makeSingleRouteRepository();
  return {
    ...repository,
    findEnabledRoutes: async (modelId) => [
      ...await repository.findEnabledRoutes(modelId),
      {
        route: {
          id: "route-b",
          modelId: "model-a",
          providerId: "provider-b",
          upstreamModelName: "fallback-model",
          priority: 1,
          weight: 1,
          enabled: true,
        },
        provider: {
          id: "provider-b",
          name: "Provider B",
          protocol: "openai",
          baseUrl: "https://fallback.example.com/v1",
          apiKeysEnc: encryptedKeys,
          headersJson: {},
          enabled: true,
        },
      },
    ],
  };
}

function mockStreamResult(parts: unknown[], finishReason: string, usage: Record<string, number>) {
  return {
    stream: (async function* () {
      for (const part of parts) yield part;
    })(),
    usage: Promise.resolve(usage),
    finishReason: Promise.resolve(finishReason),
  } as never;
}

async function collectStream(abortSignal?: AbortSignal) {
  const events = [];
  for await (const event of streamChat({
    ctx: { userId: "user-a", keyKind: null, source: "chat" },
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    },
    abortSignal,
    userAgent: "Nekusora-Test",
  })) {
    events.push(event);
  }
  return events;
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
    mocks.startExecution.mockClear();
    mocks.recordAttempt.mockClear();
    mocks.finalizeExecution.mockClear();
    mocks.markProviderStreamUsageUnsupported.mockClear();
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
    expect(mocks.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({
          code: "auth_error",
          httpStatus: 401,
          message: "upstream failed for [REDACTED] and [REDACTED]",
        }),
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

      const output = JSON.stringify(mocks.recordAttempt.mock.calls);
      expect(streamText).toHaveBeenCalledTimes(2);
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

  it.each([
    [
      "正文",
      { type: "text-delta", text: "primary" },
      { type: "text-delta", text: "primary" },
      true,
    ],
    [
      "推理",
      { type: "reasoning-delta", text: "thinking" },
      { type: "reasoning-delta", text: "thinking" },
      false,
    ],
    [
      "工具调用",
      { type: "tool-call", toolCallId: "call-1", toolName: "search", input: { q: "hello" } },
      { type: "tool-call", toolCallId: "call-1", toolName: "search", args: { q: "hello" } },
      false,
    ],
  ])("首路由已输出%s后失败时不再转移到下一路由", async (_label, upstreamEvent, expectedEvent, isVisibleText) => {
    setRouteRepository(makeTwoRouteRepository());
    vi.mocked(streamText)
      .mockReturnValueOnce({
        stream: (async function* () {
          yield upstreamEvent;
          yield { type: "error", error: new Error("connect ETIMEDOUT") };
        })(),
      } as never)
      .mockReturnValueOnce({
        stream: (async function* () {
          yield { type: "text-delta", text: "fallback" };
        })(),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        finishReason: Promise.resolve("stop"),
      } as never);

    const events = await collectStream();

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expectedEvent,
      { type: "error", error: "connect ETIMEDOUT", code: "generation_failed" },
    ]);
    expect(mocks.recordAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "failed" }),
    }));
    const finalTelemetry = mocks.finalizeExecution.mock.calls[0]?.[0] as {
      firstTokenLatencyMs?: number;
    };
    const attemptTelemetry = mocks.recordAttempt.mock.calls[0]?.[0] as {
      firstTokenLatencyMs?: number;
    };
    if (isVisibleText) {
      expect(attemptTelemetry.firstTokenLatencyMs).toEqual(expect.any(Number));
      expect(finalTelemetry.firstTokenLatencyMs).toEqual(expect.any(Number));
    } else {
      expect(attemptTelemetry.firstTokenLatencyMs).toBeUndefined();
      expect(finalTelemetry.firstTokenLatencyMs).toBeUndefined();
    }
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 1,
    });
  });

  it("首 token 延迟忽略 reasoning 和空 delta，只按首个非空正文统计", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        now = 1_100;
        yield { type: "reasoning-delta", text: "thinking" };
        now = 1_200;
        yield { type: "text-delta", text: "" };
        now = 1_300;
        yield { type: "text-delta", text: "visible" };
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
      finishReason: Promise.resolve("stop"),
    } as never);

    const events = await collectStream();

    expect(events).toEqual([
      { type: "reasoning-delta", text: "thinking" },
      { type: "text-delta", text: "" },
      { type: "text-delta", text: "visible" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
    ]);
    expect(mocks.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      firstTokenLatencyMs: 300,
    }));
    expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      firstTokenLatencyMs: 300,
    }));
  });

  it("首路由未输出即失败时仍转移到下一路由", async () => {
    setRouteRepository(makeTwoRouteRepository());
    vi.mocked(streamText)
      .mockReturnValueOnce({
        stream: (async function* () {
          yield { type: "error", error: new Error("connect ETIMEDOUT") };
        })(),
      } as never)
      .mockReturnValueOnce({
        stream: (async function* () {
          yield { type: "text-delta", text: "fallback" };
        })(),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        finishReason: Promise.resolve("stop"),
      } as never);

    const events = await collectStream();

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: "text-delta", text: "fallback" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);
    expect(mocks.recordAttempt).toHaveBeenCalledTimes(2);
    expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        status: "success",
        route: expect.objectContaining({ routeId: "route-b" }),
      }),
    }));
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 1,
    });
  });

  it("OpenAI-compatible 明确拒绝 stream_options 时自动持久化并同 key 重试", async () => {
    const repository = makeSingleRouteRepository();
    setRouteRepository({
      ...repository,
      findEnabledRoutes: async (modelId) => {
        const [entry] = await repository.findEnabledRoutes(modelId);
        return [{
          route: { ...entry!.route, apiFormat: "openai-chat" },
          provider: {
            ...entry!.provider,
            protocol: "openai-compatible",
            supportsStreamUsage: true,
          },
        }];
      },
    });
    vi.mocked(streamText)
      .mockReturnValueOnce({
        stream: (async function* () {
          yield {
            type: "error",
            error: Object.assign(
              new Error("invalid_request_error: Unsupported parameter: 'stream_options'."),
              { statusCode: 400 },
            ),
          };
        })(),
      } as never)
      .mockReturnValueOnce(mockStreamResult(
        [{ type: "text-delta", text: "answer" }],
        "stop",
        { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      ));

    const events = await collectStream();

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(mocks.markProviderStreamUsageUnsupported)
      .toHaveBeenCalledWith("provider-a", "https://example.com/v1");
    expect(events).toEqual([
      { type: "text-delta", text: "answer" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ]);
    expect(mocks.recordAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "failed",
      error: expect.objectContaining({ code: "stream_options_not_supported" }),
    }));
    expect(mocks.recordAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({
      status: "success",
    }));
    expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "success" }),
    }));
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 0,
    });
  });

  it("streamChat 自然结束后回调最终 usage", async () => {
    vi.mocked(streamText).mockReturnValue(mockStreamResult(
      [{ type: "text-delta", text: "answer" }],
      "stop",
      { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    ));
    const onFinalUsage = vi.fn();

    const events = [];
    for await (const event of streamChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
      suppressFinalUsageLog: true,
      onFinalUsage,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text-delta", text: "answer" },
      { type: "finish", finishReason: "stop", usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
    ]);
    expect(onFinalUsage).toHaveBeenCalledOnce();
    expect(onFinalUsage).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        status: "success",
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      }),
    }));
  });

  it("最终 usage 回调失败不改写 stream 结果", async () => {
    vi.mocked(streamText).mockReturnValue(mockStreamResult(
      [{ type: "text-delta", text: "answer" }],
      "stop",
      { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ));
    const onFinalUsage = vi.fn(() => {
      throw new Error("telemetry callback failed");
    });

    const events = [];
    for await (const event of streamChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      userAgent: "Nekusora-Test",
      suppressFinalUsageLog: true,
      onFinalUsage,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "finish" });
    expect(onFinalUsage).toHaveBeenCalledOnce();
  });

  it("streamChat 被 Abort 后外部 return 仍终结内部 execution", async () => {
    const abortController = new AbortController();
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield { type: "text-delta", text: "partial" };
        await new Promise<void>(() => {});
      })(),
    } as never);
    const onFinalUsage = vi.fn();
    const iterator = streamChat({
      ctx: { userId: "user-a", keyKind: null, source: "chat" },
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      abortSignal: abortController.signal,
      userAgent: "Nekusora-Test",
      suppressFinalUsageLog: true,
      onFinalUsage,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "text-delta", text: "partial" },
    });
    abortController.abort();
    await iterator.return?.();

    await vi.waitFor(() => expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "interrupted" }),
    })));
    expect(mocks.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "interrupted" }));
    expect(onFinalUsage).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ status: "interrupted" }),
    }));
  });

  it("同一 Provider 已输出正文后失败时不再尝试其他 key", async () => {
    const originalEncryptedKeys = encryptedKeys;
    encryptedKeys = encrypt(JSON.stringify({
      keys: [
        { key: "sk-first-fake", weight: 1 },
        { key: "sk-second-fake", weight: 1 },
      ],
    }));
    setRouteRepository(makeSingleRouteRepository());
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield { type: "text-delta", text: "primary" };
        yield { type: "error", error: new Error("connect ETIMEDOUT") };
      })(),
    } as never);

    try {
      const events = await collectStream();

      expect(streamText).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        { type: "text-delta", text: "primary" },
        { type: "error", error: "connect ETIMEDOUT", code: "generation_failed" },
      ]);
      expect(mocks.recordAttempt).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
        outcome: expect.objectContaining({ status: "failed", committed: true }),
      }));
      expect(snapshotBreakers()["provider-a"]).toMatchObject({
        status: "closed",
        failures: 1,
      });
    } finally {
      encryptedKeys = originalEncryptedKeys;
    }
  });

  it("已输出正文后中止时不重试且只记录 interrupted", async () => {
    const abortController = new AbortController();
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    setRouteRepository(makeTwoRouteRepository());
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield { type: "text-delta", text: "primary" };
        abortController.abort();
        yield { type: "error", error: abortError };
      })(),
    } as never);

    const events = await collectStream(abortController.signal);

    expect(streamText).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "text-delta", text: "primary" }]);
    expect(mocks.recordAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "interrupted",
    }));
    expect(mocks.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "interrupted" }),
    }));
    expect(snapshotBreakers()["provider-a"]).toMatchObject({
      status: "closed",
      failures: 0,
    });
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
    expect(mocks.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "network_error",
          message: "connect ETIMEDOUT for [REDACTED] and [REDACTED]",
        }),
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
