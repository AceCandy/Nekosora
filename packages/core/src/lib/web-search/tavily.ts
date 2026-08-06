import { z } from "zod";
import type { SearchProvider } from "./types";
import { SearchProviderError } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const responseSchema = z.object({
  results: z.array(z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
    published_date: z.string().optional(),
  })).optional(),
});

export function createTavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    supportsTimeRange: () => true,
    async search(query, opts = {}) {
      const timeRange = opts.timeRange?.preset === "custom"
        ? { start_date: opts.timeRange.startDate, end_date: opts.timeRange.endDate }
        : opts.timeRange
          ? { time_range: opts.timeRange.preset }
          : {};
      const res = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: opts.maxResults ?? 5,
          ...timeRange,
        }),
        signal: opts.signal,
      });
      if (!res.ok) throw new SearchProviderError(`tavily HTTP ${res.status}`, res.status);
      const data = responseSchema.parse(await res.json());
      return (data.results ?? []).map((item) => ({
        title: item.title ?? "(无标题)",
        url: item.url ?? "",
        snippet: item.content ?? "",
        ...(item.published_date ? { publishedAt: item.published_date } : {}),
      }));
    },
  };
}
