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
