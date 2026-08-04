import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedExternalSearchBackend, SearchTimeRange } from "./types";

const mocks = vi.hoisted(() => ({
  resolveExternalSearchBackends: vi.fn(),
  loadConfig: vi.fn(),
  executeHostedModelSearch: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

vi.mock("./registry", () => ({
  resolveExternalSearchBackends: mocks.resolveExternalSearchBackends,
  loadConfig: mocks.loadConfig,
}));

vi.mock("./hosted-model", () => ({
  executeHostedModelSearch: mocks.executeHostedModelSearch,
}));

vi.mock("@/lib/infra/cache", () => ({
  cacheGet: mocks.cacheGet,
  cacheSet: mocks.cacheSet,
}));

import { searchWeb } from "./service";

function backend(
  id: string,
  search: ResolvedExternalSearchBackend["provider"]["search"],
  supportsTimeRange?: (timeRange: SearchTimeRange) => boolean,
): ResolvedExternalSearchBackend {
  return {
    backend: { type: "provider", providerId: id },
    identity: { type: "provider", id, name: id },
    cacheKey: id,
    provider: { name: id, search, supportsTimeRange },
  };
}

const weekRange: SearchTimeRange = {
  preset: "week",
  startDate: "2026-07-29",
  endDate: "2026-08-04",
};

function searchOptions(timeRange?: SearchTimeRange) {
  return {
    ctx: { userId: "user", keyKind: null, source: "chat" as const },
    runId: "run",
    toolCallId: "tool-call",
    currentModelId: "current-model-id",
    currentModelName: "Current Model",
    signal: new AbortController().signal,
    timeRange,
  };
}

beforeEach(() => {
  mocks.resolveExternalSearchBackends.mockReset();
  mocks.loadConfig.mockReset().mockResolvedValue({
    version: 2,
    providers: [],
    backends: [],
  });
  mocks.executeHostedModelSearch.mockReset();
  mocks.cacheGet.mockReset().mockResolvedValue(undefined);
  mocks.cacheSet.mockReset().mockResolvedValue(undefined);
});

describe("有序外接搜索", () => {
  it("首个失败后使用下一后端", async () => {
    const first = vi.fn().mockRejectedValue(new Error("failed"));
    const second = vi.fn().mockResolvedValue([
      { title: "Result", url: "https://example.com/a", snippet: "text" },
    ]);
    mocks.resolveExternalSearchBackends.mockResolvedValue([
      backend("first", first), backend("second", second),
    ]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [
        { type: "provider", providerId: "first" },
        { type: "provider", providerId: "second" },
      ],
    });

    await expect(searchWeb("user", "query")).resolves.toMatchObject({
      hit: true,
      backend: { id: "second" },
    });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("过滤非法 URL、凭据和重复结果", async () => {
    mocks.resolveExternalSearchBackends.mockResolvedValue([backend("provider", vi.fn().mockResolvedValue([
      {
        title: " A ",
        url: "https://example.com/a#fragment",
        snippet: " text ",
        publishedAt: "2026-08-03",
      },
      { title: "duplicate", url: "https://example.com/a", snippet: "duplicate" },
      { title: "bad", url: "javascript:alert(1)", snippet: "bad" },
      { title: "secret", url: "https://user:pass@example.com", snippet: "bad" },
    ]))]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });

    const result = await searchWeb("user", "query");
    expect(result.results).toEqual([{
      title: "A",
      url: "https://example.com/a",
      snippet: "text",
      publishedAt: "2026-08-03T00:00:00.000Z",
    }]);
  });

  it("最近 7 天无结果后只回退一次到最近 30 天", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { title: "Recent", url: "https://example.com/recent", snippet: "text" },
      ]);
    mocks.resolveExternalSearchBackends.mockResolvedValue([
      backend("provider", search, () => true),
    ]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });

    const result = await searchWeb("user", "latest", searchOptions(weekRange));

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map(([, options]) => options?.timeRange?.preset)).toEqual([
      "week",
      "month",
    ]);
    expect(result).toMatchObject({
      hit: true,
      requestedTimeRange: weekRange,
      effectiveTimeRange: {
        preset: "month",
        startDate: "2026-07-06",
        endDate: "2026-08-04",
      },
      freshnessFallback: true,
      attempts: [{ outcome: "empty" }, { outcome: "success" }],
    });
  });

  it("不支持 7 天的后端不发请求，只在 30 天回退轮调用", async () => {
    const search = vi.fn().mockResolvedValue([
      { title: "Monthly", url: "https://example.com/monthly", snippet: "text" },
    ]);
    mocks.resolveExternalSearchBackends.mockResolvedValue([
      backend("provider", search, (timeRange) => timeRange.preset === "month"),
    ]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });

    const result = await searchWeb("user", "latest", searchOptions(weekRange));

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("latest", expect.objectContaining({
      timeRange: expect.objectContaining({ preset: "month" }),
    }));
    expect(result.attempts).toMatchObject([
      { outcome: "unsupported", timeRange: { preset: "week" } },
      { outcome: "success", timeRange: { preset: "month" } },
    ]);
  });

  it("最近 30 天无结果时不再执行无限制搜索", async () => {
    const search = vi.fn().mockResolvedValue([]);
    mocks.resolveExternalSearchBackends.mockResolvedValue([
      backend("provider", search, () => true),
    ]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });
    const monthRange: SearchTimeRange = {
      preset: "month",
      startDate: "2026-07-06",
      endDate: "2026-08-04",
    };

    const result = await searchWeb("user", "recent", searchOptions(monthRange));

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("recent", expect.objectContaining({ timeRange: monthRange }));
    expect(result).toMatchObject({
      hit: false,
      requestedTimeRange: monthRange,
      effectiveTimeRange: monthRange,
      attempts: [{ outcome: "empty" }],
    });
  });

  it("最近 7 天回退后仍无结果时记录实际范围", async () => {
    const search = vi.fn().mockResolvedValue([]);
    mocks.resolveExternalSearchBackends.mockResolvedValue([
      backend("provider", search, () => true),
    ]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });

    const result = await searchWeb("user", "latest", searchOptions(weekRange));

    expect(result).toMatchObject({
      hit: false,
      requestedTimeRange: weekRange,
      effectiveTimeRange: {
        preset: "month",
        startDate: "2026-07-06",
        endDate: "2026-08-04",
      },
      freshnessFallback: true,
    });
  });

  it("不同时间范围使用不同缓存键", async () => {
    const search = vi.fn().mockResolvedValue([
      { title: "Result", url: "https://example.com/result", snippet: "text" },
    ]);
    mocks.resolveExternalSearchBackends.mockResolvedValue([
      backend("provider", search, () => true),
    ]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });
    const monthRange: SearchTimeRange = {
      preset: "month",
      startDate: "2026-07-06",
      endDate: "2026-08-04",
    };

    await searchWeb("user", "same query", searchOptions(weekRange));
    await searchWeb("user", "same query", searchOptions(monthRange));

    expect(mocks.cacheGet).toHaveBeenCalledTimes(2);
    expect(mocks.cacheGet.mock.calls[0][0]).not.toBe(mocks.cacheGet.mock.calls[1][0]);
  });

  it("调用方取消会传到底层并终止搜索", async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const search = vi.fn((_query, options) => new Promise((_, reject) => {
      markStarted();
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    mocks.resolveExternalSearchBackends.mockResolvedValue([backend("provider", search)]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "provider", providerId: "provider" }],
    });
    const result = searchWeb("user", "query", {
      ctx: { userId: "user", keyKind: null, source: "chat" },
      runId: "run",
      toolCallId: "tool-call",
      currentModelId: "current-model-id",
      currentModelName: "Current Model",
      signal: controller.signal,
    });
    await started;
    controller.abort(new DOMException("Aborted", "AbortError"));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(search).toHaveBeenCalledOnce();
  });

  it("按全局顺序从当前模型降级到指定代搜模型", async () => {
    mocks.resolveExternalSearchBackends.mockResolvedValue([]);
    mocks.loadConfig.mockResolvedValue({
      version: 2,
      providers: [],
      backends: [{ type: "current-model" }, { type: "model", modelId: "grok-id" }],
    });
    mocks.executeHostedModelSearch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        summary: "grounded",
        citations: [{ title: "Source", url: "https://example.com", snippet: "" }],
        modelId: "grok-id",
        modelName: "Grok 4.5",
      });

    const result = await searchWeb("user", "query", {
      ctx: { userId: "user", keyKind: null, source: "chat" },
      runId: "run",
      toolCallId: "tool-call",
      currentModelId: "glm-id",
      currentModelName: "GLM",
      signal: new AbortController().signal,
    });

    expect(mocks.executeHostedModelSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      modelId: "glm-id",
      modelName: "GLM",
    }));
    expect(mocks.executeHostedModelSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      modelId: "grok-id",
    }));
    expect(result).toMatchObject({
      hit: true,
      groundedSummary: "grounded",
      backend: { type: "model", id: "grok-id", name: "Grok 4.5" },
      attempts: [{ outcome: "empty" }, { outcome: "success" }],
    });
  });
});
