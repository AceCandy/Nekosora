import { z } from "zod";
import type { SearchProvider } from "./types";
import { SearchProviderError } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const responseSchema = z.object({
  results: z.array(z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
  })).optional(),
});

export function createTavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    async search(query, opts = {}) {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: opts.maxResults ?? 5 }),
        signal: opts.signal,
      });
      if (!res.ok) throw new SearchProviderError(`tavily HTTP ${res.status}`, res.status);
      const data = responseSchema.parse(await res.json());
      return (data.results ?? []).map((item) => ({
        title: item.title ?? "(无标题)",
        url: item.url ?? "",
        snippet: item.content ?? "",
      }));
    },
  };
}
