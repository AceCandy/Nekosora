import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  buildLanguageModelWithKey: vi.fn(() => ({})),
}));

vi.mock("@/lib/providers/registry", () => ({
  buildLanguageModelWithKey: (...args: unknown[]) =>
    mocks.buildLanguageModelWithKey(...args),
}));

import { generateText, streamText } from "ai";
import { fetchUpstreamModels, probeProviderKey } from "./probe";

const baseOpts = {
  protocol: "openai" as const,
  baseUrl: "https://api.example.com",
  apiKey: "sk-test",
};

/** 用给定实现桩掉全局 fetch(忽略 AbortSignal 等 init 字段)。 */
function mockFetch(
  impl: (url: string, init?: RequestInit) => Promise<Partial<Response> | never>,
) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => impl(url, init)));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(generateText).mockReset();
  vi.mocked(streamText).mockReset();
  mocks.buildLanguageModelWithKey.mockReset().mockReturnValue({});
});

describe("probeProviderKey 连通性探测(errorKind 分级)", () => {
  it("连接停滞时使用 Provider connect timeout 并清理计时器", async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const pending = probeProviderKey({
      ...baseOpts,
      connectTimeoutMs: 1_000,
      readTimeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      errorKind: "network",
      error: "Provider connect timeout after 1000ms",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetch 抛网络错 -> errorKind network, ok false", async () => {
    mockFetch(() => Promise.reject(new Error("fetch failed")));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("network");
  });

  it("ECONNREFUSED 也判 network", async () => {
    mockFetch(() => Promise.reject(new Error("connect ECONNREFUSED 1.2.3.4:443")));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("network");
  });

  it("401 -> errorKind auth", async () => {
    mockFetch(() => Promise.resolve({ status: 401, statusText: "Unauthorized" }));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("auth");
  });

  it("鉴权响应体停滞时使用 Provider read timeout", async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) => Promise.resolve({
      status: 401,
      statusText: "Unauthorized",
      text: () => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }));

    const pending = probeProviderKey({
      ...baseOpts,
      connectTimeoutMs: 15_000,
      readTimeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      errorKind: "network",
      error: "Provider read timeout after 10000ms",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("403 -> errorKind auth", async () => {
    mockFetch(() => Promise.resolve({ status: 403, statusText: "Forbidden" }));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("auth");
  });

  it("500 -> errorKind unknown(非 network,网络层仍算通)", async () => {
    mockFetch(() => Promise.resolve({ status: 500, statusText: "Internal Server Error" }));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("unknown");
  });

  it("200 -> ok true,无 errorKind", async () => {
    mockFetch(() => Promise.resolve({ status: 200, statusText: "OK" }));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(true);
    expect(r.errorKind).toBeUndefined();
  });

  it("400 -> ok true(valid key 缺 messages 等字段,chat 端点已校验 key)", async () => {
    mockFetch(() => Promise.resolve({ status: 400, statusText: "Bad Request" }));
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(true);
  });

  it("缺 baseUrl -> errorKind unknown", async () => {
    const r = await probeProviderKey({ protocol: "openai", baseUrl: "", apiKey: "sk-test" });
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("unknown");
  });

  it("401 + ModelError body(opencode 伪 401,空 body 缺 model)-> errorKind unknown,非 auth", async () => {
    mockFetch(() =>
      Promise.resolve({
        status: 401,
        statusText: "Unauthorized",
        text: () =>
          Promise.resolve(
            '{"type":"error","error":{"type":"ModelError","message":"Model {{model}} is not supported"}}',
          ),
      }),
    );
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("unknown");
  });

  it("401 + AuthError body(真鉴权失败)-> errorKind auth", async () => {
    mockFetch(() =>
      Promise.resolve({
        status: 401,
        statusText: "Unauthorized",
        text: () =>
          Promise.resolve(
            '{"type":"error","error":{"type":"AuthError","message":"Invalid API key."}}',
          ),
      }),
    );
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("auth");
  });
});

describe("probeProviderKey gemini /models 无效 key 识别", () => {
  // gemini 退回 GET /models,官方对无效 key 返 400(非 401/403)+ "API key not valid" body;
  // 通用判定会误把 400 当"key 有效",需解析 body 纠正。
  it("gemini 400 + 'API key not valid' body -> errorKind auth", async () => {
    mockFetch(() =>
      Promise.resolve({
        status: 400,
        statusText: "Bad Request",
        text: () =>
          Promise.resolve(
            '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
          ),
      }),
    );
    const r = await probeProviderKey({ ...baseOpts, protocol: "gemini" as const });
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("auth");
  });

  it("gemini 400 + 'API_KEY_INVALID' body -> errorKind auth", async () => {
    mockFetch(() =>
      Promise.resolve({
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve('{"error":{"message":"API_KEY_INVALID"}}'),
      }),
    );
    const r = await probeProviderKey({ ...baseOpts, protocol: "gemini" as const });
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("auth");
  });

  it("gemini 200 + 模型列表 body -> ok true(不误伤有效 key)", async () => {
    mockFetch(() =>
      Promise.resolve({
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve('{"models":[{"name":"models/gemini-1.5-flash"}]}'),
      }),
    );
    const r = await probeProviderKey({ ...baseOpts, protocol: "gemini" as const });
    expect(r.ok).toBe(true);
  });

  it("openai 400 缺字段 body(无 key 无效字样)仍 ok true(通用判定不受影响)", async () => {
    mockFetch(() =>
      Promise.resolve({
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve('{"error":{"message":"messages is required"}}'),
      }),
    );
    const r = await probeProviderKey(baseOpts);
    expect(r.ok).toBe(true);
  });

  it("Gemini fetch 错误不会返回 URL key 或自定义 header 值", async () => {
    const apiKey = "GEMINI_SECRET";
    const headerSecret = "HEADER_SECRET";
    mockFetch((url) =>
      Promise.reject(
        new Error(`fetch failed: ${url} x-custom-auth=${headerSecret}`),
      ),
    );

    const r = await probeProviderKey({
      ...baseOpts,
      protocol: "gemini",
      apiKey,
      headers: { "x-custom-auth": headerSecret },
    });

    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("network");
    expect(r.error).toContain("fetch failed");
    expect(r.error).not.toContain(apiKey);
    expect(r.error).not.toContain(headerSecret);
  });
});

describe("probeProviderKey 模型深度探测脱敏", () => {
  it("具体 route 探测保留 route apiFormat，不按 provider protocol 猜测", async () => {
    vi.useFakeTimers();
    vi.mocked(generateText).mockResolvedValue({ text: "hello" } as never);

    const result = await probeProviderKey({
      ...baseOpts,
      protocol: "openai-compatible",
      apiFormat: "openai-responses",
      upstreamModelName: "demo-model",
      connectTimeoutMs: 2_000,
      readTimeoutMs: 10_000,
      streamIdleTimeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(result.responseText).toBe("hello");
    expect(mocks.buildLanguageModelWithKey).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "openai-compatible",
        apiFormat: "openai-responses",
        provider: expect.objectContaining({
          connectTimeoutMs: 2_000,
          readTimeoutMs: 10_000,
          streamIdleTimeoutMs: 5_000,
        }),
      }),
      "sk-test",
      undefined,
      undefined,
      undefined,
    );
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      maxRetries: 0,
      providerOptions: { openai: { store: false } },
      abortSignal: expect.any(AbortSignal),
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("非流式与流式回退共用 15 秒总预算并传递流空闲超时", async () => {
    vi.useFakeTimers();
    let generateSignal: AbortSignal | undefined;
    vi.mocked(generateText).mockImplementationOnce((options) => {
      generateSignal = options.abortSignal;
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("non-stream failed")), 12_000);
      });
    });
    vi.mocked(streamText).mockImplementationOnce((options) => ({
      consumeStream: vi.fn(() => new Promise((_resolve, reject) => {
        const signal = options.abortSignal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })),
    }) as never);

    const pending = probeProviderKey({
      ...baseOpts,
      upstreamModelName: "demo-model",
      readTimeoutMs: 900_000,
      streamIdleTimeoutMs: 900_000,
    });
    let settled = false;
    void pending.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(12_000);
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: generateSignal,
      timeout: { chunkMs: 900_000 },
    }));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({ ok: false, errorKind: "network" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("provider model 构造失败也收敛为安全 ProbeResult", async () => {
    const apiKey = "MODEL_BUILD_SECRET";
    const headerSecret = "MODEL_BUILD_HEADER_SECRET";
    mocks.buildLanguageModelWithKey.mockImplementationOnce(() => {
      throw new Error(`model build failed for ${apiKey} and ${headerSecret}`);
    });

    const r = await probeProviderKey({
      ...baseOpts,
      apiKey,
      upstreamModelName: "demo-model",
      headers: { "x-custom": headerSecret },
    });

    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("unknown");
    expect(r.error).toBe("model build failed for [REDACTED] and [REDACTED]");
  });

  it("流式回退成功时 nonStreamError 不含当前 key 或 header 值", async () => {
    const apiKey = "MODEL_SECRET";
    const headerSecret = "CUSTOM_HEADER_SECRET";
    vi.mocked(generateText).mockRejectedValue(
      new Error(`upstream failed apiKey=${apiKey} x-custom=${headerSecret}`),
    );
    vi.mocked(streamText).mockReturnValue({
      consumeStream: vi.fn().mockResolvedValue(undefined),
    } as never);

    const r = await probeProviderKey({
      ...baseOpts,
      apiKey,
      upstreamModelName: "demo-model",
      headers: { "x-custom": headerSecret },
    });

    expect(r).toMatchObject({ ok: true, mode: "stream" });
    expect(r.nonStreamError).toContain("upstream failed");
    expect(r.nonStreamError).not.toContain(apiKey);
    expect(r.nonStreamError).not.toContain(headerSecret);
  });

  it("非流式与流式均失败时组合 error 只保留安全诊断", async () => {
    const apiKey = "MODEL_SECRET";
    const headerSecret = "CUSTOM_HEADER_SECRET";
    vi.mocked(generateText).mockRejectedValue(
      new Error(`non-stream failed for ${apiKey}`),
    );
    vi.mocked(streamText).mockReturnValue({
      consumeStream: vi.fn(async ({
        onError,
      }: { onError?: (error: unknown) => void }) => {
        onError?.(new Error(`stream failed for ${headerSecret}`));
      }),
    } as never);

    const r = await probeProviderKey({
      ...baseOpts,
      apiKey,
      upstreamModelName: "demo-model",
      headers: { "x-custom": headerSecret },
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe(
      "非流式: non-stream failed for [REDACTED]; 流式: stream failed for [REDACTED]",
    );
    expect(r.error).not.toContain(apiKey);
    expect(r.error).not.toContain(headerSecret);
  });
});

describe("fetchUpstreamModels 脱敏边界", () => {
  it("响应体停滞时使用 Provider read timeout 并清理计时器", async () => {
    vi.useFakeTimers();
    mockFetch((_url, init) => Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }));

    const pending = fetchUpstreamModels({
      ...baseOpts,
      connectTimeoutMs: 15_000,
      readTimeoutMs: 10_000,
    });
    const rejection = expect(pending).rejects.toThrow("Provider read timeout after 10000ms");
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Gemini fetch 异常离开持 key 边界前会重建为安全 Error", async () => {
    const apiKey = "LIST_SECRET";
    const headerSecret = "LIST_HEADER_SECRET";
    mockFetch((url) =>
      Promise.reject(new Error(`fetch failed: ${url} x-custom=${headerSecret}`)),
    );

    let caught: Error | undefined;
    try {
      await fetchUpstreamModels({
        protocol: "gemini",
        baseUrl: baseOpts.baseUrl,
        apiKey,
        headers: { "x-custom": headerSecret },
      });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("fetch failed");
    expect(caught?.message).not.toContain(apiKey);
    expect(caught?.message).not.toContain(headerSecret);
    expect(caught?.stack).not.toContain(apiKey);
    expect(caught?.stack).not.toContain(headerSecret);
  });
});
