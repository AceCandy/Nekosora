import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestPublicJson: vi.fn() }));

vi.mock("./public-http", () => ({ requestPublicJson: mocks.requestPublicJson }));

import { createSearxngProvider } from "./searxng";
import { createTavilyProvider } from "./tavily";
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
    const month: SearchTimeRange = {
      preset: "month",
      startDate: "2026-07-06",
      endDate: "2026-08-04",
    };

    expect(provider.supportsTimeRange?.(week)).toBe(false);
    expect(provider.supportsTimeRange?.(month)).toBe(true);
    await provider.search("recent", { timeRange: month });

    const requestedUrl = mocks.requestPublicJson.mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get("time_range")).toBe("month");
  });
});
