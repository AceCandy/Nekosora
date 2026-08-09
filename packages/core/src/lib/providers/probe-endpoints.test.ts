import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteApiFormat } from "@/db/types";
import { probeProviderKey } from "./probe";

const API_KEY = "probe-test-key";

describe("route model probe endpoints", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["openai-chat", "/v1/chat/completions", "authorization"],
    ["openai-responses", "/v1/responses", "authorization"],
    ["anthropic-messages", "/v1/messages", "x-api-key"],
    ["gemini-generate-content", "/v1/models/probe-model:generateContent", "x-goog-api-key"],
  ] as const)("%s 使用 route apiFormat 对应的真实 endpoint", async (
    apiFormat,
    pathname,
    authHeader,
  ) => {
    const captured: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push(new Request(input, init));
      throw new TypeError("fetch failed");
    }));

    const result = await probeProviderKey({
      protocol: "openai-compatible",
      apiFormat: apiFormat as RouteApiFormat,
      baseUrl: "https://probe.example/v1/",
      apiKey: API_KEY,
      upstreamModelName: "probe-model",
    });

    expect(result).toMatchObject({ ok: false, errorKind: "network" });
    expect(captured).toHaveLength(1);
    expect(new URL(captured[0].url).pathname).toBe(pathname);
    expect(captured[0].headers.get(authHeader)).toBe(
      authHeader === "authorization" ? `Bearer ${API_KEY}` : API_KEY,
    );
  });
});
