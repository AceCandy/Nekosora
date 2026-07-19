import { afterEach, describe, expect, it, vi } from "vitest";
import { probeProviderKey } from "./probe";

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

afterEach(() => vi.unstubAllGlobals());

describe("probeProviderKey 连通性探测(errorKind 分级)", () => {
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
});
