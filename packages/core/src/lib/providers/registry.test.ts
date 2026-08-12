import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn(() => ({ specificationVersion: "v4" })),
    responses: vi.fn(() => ({ specificationVersion: "v4" })),
    tools: { webSearch: vi.fn((args) => ({ args })) },
  })),
  createOpenAICompatible: vi.fn(() => ({
    chatModel: vi.fn(() => ({ specificationVersion: "v4" })),
  })),
  createAnthropic: vi.fn(() => ({
    messages: vi.fn(() => ({ specificationVersion: "v4" })),
    tools: { webSearch_20250305: vi.fn((args) => ({ args })) },
  })),
  createGoogle: vi.fn(() => Object.assign(
    vi.fn(() => ({ specificationVersion: "v4" })),
    { tools: { googleSearch: vi.fn((args) => ({ args })) } },
  )),
  createXai: vi.fn(() => ({
    responses: vi.fn(() => ({ specificationVersion: "v4" })),
    tools: { webSearch: vi.fn((args) => ({ args })) },
  })),
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mocks.createAnthropic }));
vi.mock("@ai-sdk/google", () => ({ createGoogle: mocks.createGoogle }));
vi.mock("@ai-sdk/xai", () => ({ createXai: mocks.createXai }));

import {
  buildHostedSearchRuntime,
  buildLanguageModelWithKey,
} from "@/lib/providers/registry";
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenAI-compatible stream usage", () => {
  const compatibleRoute: ResolvedRoute = {
    ...route,
    protocol: "openai-compatible",
    apiFormat: "openai-chat",
    provider: {
      ...route.provider,
      protocol: "openai-compatible",
      supportsStreamUsage: null,
    },
  };

  it.each([null, true])("能力为 %s 时请求流式 usage", (supportsStreamUsage) => {
    buildLanguageModelWithKey({
      ...compatibleRoute,
      provider: { ...compatibleRoute.provider, supportsStreamUsage },
    }, "test-key");

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({
      includeUsage: true,
    }));
  });

  it("能力为 false 时省略 stream_options", () => {
    buildLanguageModelWithKey({
      ...compatibleRoute,
      provider: { ...compatibleRoute.provider, supportsStreamUsage: false },
    }, "test-key");

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({
      includeUsage: false,
    }));
  });
});

describe("Provider shared fetch", () => {
  it.each([
    ["OpenAI Chat", "openai", "openai-chat", "createOpenAI"],
    ["OpenAI-compatible Chat", "openai-compatible", "openai-chat", "createOpenAICompatible"],
    ["OpenAI Responses", "openai", "openai-responses", "createOpenAI"],
    ["Anthropic Messages", "anthropic", "anthropic-messages", "createAnthropic"],
    ["Gemini GenerateContent", "gemini", "gemini-generate-content", "createGoogle"],
  ] as const)("%s 始终安装 connect timeout fetch", (
    _label,
    protocol,
    apiFormat,
    factory,
  ) => {
    buildLanguageModelWithKey({
      ...route,
      protocol,
      apiFormat,
      provider: {
        ...route.provider,
        protocol,
        connectTimeoutMs: 1_234,
      },
    }, "test-key", undefined, undefined, "Nekusora/Test");

    expect(mocks[factory]).toHaveBeenCalledWith(expect.objectContaining({
      fetch: expect.any(Function),
    }));
  });
});

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

    expect(mocks.createGoogle).toHaveBeenCalledWith(expect.objectContaining({
      fetch: expect.any(Function),
    }));
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
