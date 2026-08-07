import { z } from "zod";
import type { SearchProvider } from "./types";
import { SearchProviderError } from "./types";

const EXA_ENDPOINT = "https://api.exa.ai/search";
const MAX_NUM_RESULTS = 100;
const HIGHLIGHT_MAX_CHARACTERS = 600;

const responseSchema = z.object({
  results: z.array(z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    publishedDate: z.string().optional(),
    highlights: z.array(z.string()).optional(),
  })).optional(),
});

/** 使用 Exa 语义搜索，并返回有界的来源原文片段。 */
export function createExaProvider(apiKey: string): SearchProvider {
  return {
    name: "exa",
    supportsTimeRange: () => true,
    async search(query, opts = {}) {
      const requestedResults = opts.maxResults ?? 5;
      const numResults = Number.isFinite(requestedResults)
        ? Math.min(MAX_NUM_RESULTS, Math.max(1, Math.floor(requestedResults)))
        : 5;
      const timeRange = opts.timeRange
        ? {
            startPublishedDate: `${opts.timeRange.startDate}T00:00:00.000Z`,
            endPublishedDate: `${opts.timeRange.endDate}T23:59:59.999Z`,
          }
        : {};
      const res = await fetch(EXA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          query,
          numResults,
          contents: { highlights: { maxCharacters: HIGHLIGHT_MAX_CHARACTERS } },
          ...timeRange,
        }),
        signal: opts.signal,
      });
      if (!res.ok) throw new SearchProviderError(`exa HTTP ${res.status}`, res.status);
      const data = responseSchema.parse(await res.json());
      return (data.results ?? []).map((item) => ({
        title: item.title ?? "(无标题)",
        url: item.url ?? "",
        snippet: (item.highlights ?? []).map((value) => value.trim()).filter(Boolean).join("\n"),
        ...(item.publishedDate ? { publishedAt: item.publishedDate } : {}),
      }));
    },
  };
}
