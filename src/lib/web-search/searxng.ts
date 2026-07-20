/**
 * Searxng 自建搜索适配器 -- https://docs.searxng.org/dev/search_api.html
 *
 * 自托管实例,GET ${baseUrl}/search?q=...&format=json,无需 api key。
 * 响应:results 数组,每项含 title/url/content。
 */
import type { SearchProvider, SearchResult, SearchOptions } from "./types";

export function createSearxngProvider(baseUrl: string): SearchProvider {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    name: "searxng",
    async search(query, opts: SearchOptions = {}): Promise<SearchResult[]> {
      const url = `${root}/search?q=${encodeURIComponent(query)}&format=json`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`searxng HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
      return (data.results ?? []).slice(0, opts.maxResults ?? 5).map((r) => ({
        title: r.title ?? "(无标题)",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 300),
      }));
    },
  };
}
