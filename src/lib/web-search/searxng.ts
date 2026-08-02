import { z } from "zod";
import { requestPublicJson } from "./public-http";
import type { SearchProvider } from "./types";
import { SearchProviderError } from "./types";

const responseSchema = z.object({
  results: z.array(z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
  })).optional(),
});

export function createSearxngProvider(baseUrl: string): SearchProvider {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    name: "searxng",
    async search(query, opts = {}) {
      const url = new URL(`${root}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      const response = await requestPublicJson(url, {
        headers: { Accept: "application/json" },
        signal: opts.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new SearchProviderError(`searxng HTTP ${response.status}`, response.status);
      }
      const data = responseSchema.parse(response.body);
      return (data.results ?? []).slice(0, opts.maxResults ?? 5).map((item) => ({
        title: item.title ?? "(无标题)",
        url: item.url ?? "",
        snippet: item.content ?? "",
      }));
    },
  };
}
