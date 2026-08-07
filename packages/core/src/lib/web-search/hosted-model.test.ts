import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAtomicGateway: vi.fn(),
  getChatUA: vi.fn(),
}));

vi.mock("@/lib/gateway-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gateway-execution")>();
  return { ...actual, executeAtomicGateway: mocks.executeAtomicGateway };
});
vi.mock("@/lib/system-settings/ua", () => ({ getChatUA: mocks.getChatUA }));

import {
  buildHostedSearchPrompt,
  executeHostedModelSearch,
  normalizeHostedSources,
} from "./hosted-model";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChatUA.mockResolvedValue("test-ua");
});

describe("buildHostedSearchPrompt", () => {
  it("注入当前日期并要求最新问题核对来源日期", () => {
    const prompt = buildHostedSearchPrompt(
      "最新的模型发布信息",
      new Date("2026-08-03T12:00:00.000Z"),
    );

    expect(prompt).toContain("当前日期（UTC）：2026-08-03");
    expect(prompt).toContain("发布日期或更新时间更近");
    expect(prompt).toContain("问题：最新的模型发布信息");
  });

  it("将不支持原生过滤的时间范围写入搜索提示词", () => {
    const prompt = buildHostedSearchPrompt(
      "OpenAI 最新动态",
      new Date("2026-08-07T12:00:00.000Z"),
      { preset: "week", startDate: "2026-08-01", endDate: "2026-08-07" },
    );

    expect(prompt).toContain("检索时间范围（UTC，含首尾日期）：2026-08-01 至 2026-08-07");
    expect(prompt).toContain("范围外信息仅可作为必要背景并明确说明");
  });

  it("保留来源提供的合法发布日期", () => {
    expect(normalizeHostedSources([{
      sourceType: "url",
      url: "https://example.com/news",
      title: "News",
      publishedAt: "2026-08-03",
    }])).toEqual([{
      title: "News",
      url: "https://example.com/news",
      snippet: "",
      publishedAt: "2026-08-03T00:00:00.000Z",
    }]);
  });
});

describe("executeHostedModelSearch", () => {
  it("选中 Hosted 路由时立即上报可读模型身份", async () => {
    mocks.executeAtomicGateway.mockImplementation(async (options) => {
      const adapter = options.selectAdapter({
        modelId: "model-uuid",
        modelName: "GPT 5.6 Luna",
        upstreamModelName: "gpt-5.6-luna",
        protocol: "openai",
        provider: {
          id: "openai",
          name: "OpenAI",
          protocol: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "test-key",
          keys: [{ key: "test-key", weight: 1 }],
        },
        priority: 0,
        weight: 1,
        source: "byo",
        routeId: "route-1",
        capabilities: { tools: true, webSearchFormat: "openai" },
        supportsTools: true,
      });
      expect(adapter).not.toBeNull();
      return { status: "failed", error: { code: "upstream_error" } };
    });
    const onRouteSelected = vi.fn();

    await executeHostedModelSearch({
      ctx: { userId: "user", keyKind: null, source: "chat" },
      modelId: "model-uuid",
      modelName: "model-uuid",
      query: "latest news",
      runId: "run-1",
      toolCallId: "tool-1",
      signal: new AbortController().signal,
      onRouteSelected,
    });

    expect(onRouteSelected).toHaveBeenCalledWith({
      modelId: "model-uuid",
      modelName: "GPT 5.6 Luna",
    });
  });
});
