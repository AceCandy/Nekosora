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
});
