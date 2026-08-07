import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestPublicJson: vi.fn() }));

vi.mock("./public-http", () => ({ requestPublicJson: mocks.requestPublicJson }));

import { createSearxngProvider } from "./searxng";
import { createTavilyProvider } from "./tavily";
import { createExaProvider } from "./exa";
import type { SearchTimeRange } from "./types";

const week: SearchTimeRange = {
  preset: "week",
  startDate: "2026-07-29",
  endDate: "2026-08-04",
};
const custom: SearchTimeRange = {
  preset: "custom",
  startDate: "2026-08-01",
  endDate: "2026-08-04",
};
const month: SearchTimeRange = {
  preset: "month",
  startDate: "2026-07-06",
  endDate: "2026-08-04",
};

beforeEach(() => {
  mocks.requestPublicJson.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("搜索 provider 时间范围", () => {
  it("Tavily 发送时间参数并保留发布日期", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{
          title: "News",
          url: "https://example.com/news",
          content: "content",
          published_date: "2026-08-03",
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createTavilyProvider("secret");

    await expect(provider.search("latest", { timeRange: week })).resolves.toEqual([{
      title: "News",
      url: "https://example.com/news",
      snippet: "content",
      publishedAt: "2026-08-03",
    }]);
    await provider.search("range", { timeRange: custom });

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(firstBody).toMatchObject({ time_range: "week" });
    expect(secondBody).toMatchObject({
      start_date: "2026-08-01",
      end_date: "2026-08-04",
    });
  });

  it("SearXNG 只声明并发送 month 时间范围", async () => {
    mocks.requestPublicJson.mockResolvedValue({ status: 200, body: { results: [] } });
    const provider = createSearxngProvider("https://search.example.com");

    expect(provider.supportsTimeRange?.(week)).toBe(false);
    expect(provider.supportsTimeRange?.(month)).toBe(true);
    await provider.search("recent", { timeRange: month });

    const requestedUrl = mocks.requestPublicJson.mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get("time_range")).toBe("month");
  });

  it("Exa 发送有界 highlights 和完整发布日期范围", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{
          title: "Semantic result",
          url: "https://example.com/exa",
          publishedDate: "2026-08-03T10:00:00.000Z",
          highlights: [" first fact ", "", "second fact"],
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createExaProvider("exa-secret");
    const controller = new AbortController();

    await expect(provider.search("semantic", {
      maxResults: 500,
      signal: controller.signal,
    })).resolves.toEqual([{
      title: "Semantic result",
      url: "https://example.com/exa",
      snippet: "first fact\nsecond fact",
      publishedAt: "2026-08-03T10:00:00.000Z",
    }]);
    await provider.search("range", { timeRange: custom });

    expect(provider.supportsTimeRange?.(week)).toBe(true);
    expect(provider.supportsTimeRange?.(month)).toBe(true);
    expect(provider.supportsTimeRange?.(custom)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.exa.ai/search");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "exa-secret" },
      signal: controller.signal,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      query: "semantic",
      numResults: 100,
      contents: { highlights: { maxCharacters: 600 } },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
      query: "range",
      numResults: 5,
      contents: { highlights: { maxCharacters: 600 } },
      startPublishedDate: "2026-08-01T00:00:00.000Z",
      endPublishedDate: "2026-08-04T23:59:59.999Z",
    });
  });

  it("Exa 将 HTTP 错误保留为可重试的 Provider 错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));

    await expect(createExaProvider("exa-secret").search("limited")).rejects.toMatchObject({
      name: "SearchProviderError",
      message: "exa HTTP 429",
      status: 429,
    });
  });

  it.each([
    [2.9, 2],
    [Number.NaN, 5],
    [Number.POSITIVE_INFINITY, 5],
  ])("Exa 将 numResults %s 规范为整数 %s", async (maxResults, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await createExaProvider("exa-secret").search("bounded", { maxResults });

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).numResults).toBe(expected);
  });
});
