import { describe, expect, it } from "vitest";
import { buildHostedSearchRuntime } from "@/lib/providers/registry";
import type { ResolvedRoute } from "@/lib/providers/types";

const route: ResolvedRoute = {
  modelName: "gemini-test",
  upstreamModelName: "gemini-test",
  protocol: "gemini",
  provider: {
    id: "provider-a",
    name: "Provider A",
    protocol: "gemini",
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    keys: [{ key: "test-key", weight: 1 }],
  },
  priority: 0,
  weight: 1,
  source: "byo",
  routeId: "route-a",
  capabilities: { tools: true, webSearchFormat: "google" },
};

describe("buildHostedSearchRuntime", () => {
  it("只有路由显式支持工具时才构造 Hosted Search", () => {
    expect(buildHostedSearchRuntime({ ...route, supportsTools: false }, "test-key")).toBeNull();
    expect(buildHostedSearchRuntime({ ...route, supportsTools: true }, "test-key")).not.toBeNull();
  });

  it("Google Hosted Search 接收明确时间范围", () => {
    const runtime = buildHostedSearchRuntime(
      { ...route, supportsTools: true },
      "test-key",
      undefined,
      { preset: "week", startDate: "2026-07-29", endDate: "2026-08-04" },
    );
    const tool = runtime?.tools.google_search as { args?: unknown };

    expect(tool.args).toMatchObject({
      timeRangeFilter: {
        startTime: "2026-07-29T00:00:00.000Z",
        endTime: "2026-08-04T23:59:59.999Z",
      },
    });
  });

  it.each([
    ["OpenAI", "openai", "openai"],
    ["Anthropic", "anthropic", "anthropic"],
    ["xAI", "openai-compatible", "xai"],
  ] as const)("%s Hosted Search 将时间范围降级为提示词约束", (_, protocol, webSearchFormat) => {
    const hostedRoute: ResolvedRoute = {
      ...route,
      protocol,
      provider: { ...route.provider, protocol },
      capabilities: { tools: true, webSearchFormat },
      supportsTools: true,
    };

    expect(buildHostedSearchRuntime(
      hostedRoute,
      "test-key",
      undefined,
      { preset: "month", startDate: "2026-07-06", endDate: "2026-08-04" },
    )).not.toBeNull();
  });
});
