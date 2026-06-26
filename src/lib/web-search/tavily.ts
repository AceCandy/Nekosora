/**
 * Tavily 搜索适配器 —— https://docs.tavily.com/api-reference/search
 *
 * 请求:POST https://api.tavily.com/search,body 含 api_key/query/max_results。
 * 响应:results 数组,每项含 title/url/content。
 */
import type { SearchProvider, SearchResult, SearchOptions } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export function createTavilyProvider(apiKey: string): SearchProvider {
  return {
    name: "tavily",
    async search(query, opts: SearchOptions = {}): Promise<SearchResult[]> {
      const maxResults = opts.maxResults ?? 5;
      const res = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
      return (data.results ?? []).map((r) => ({
        title: r.title ?? "(无标题)",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 300),
      }));
    },
  };
}
