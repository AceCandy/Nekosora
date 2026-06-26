/**
 * 博查(Bocha)搜索适配器 —— https://open.bochaai.com/docs/api
 *
 * 请求:POST https://api.bochaai.com/v1/web-search,body 含 query/count;
 * 鉴权:Authorization: Bearer <api_key>。
 * 响答:webPages.value 数组,每项含 name/url/snippet。
 */
import type { SearchProvider, SearchResult, SearchOptions } from "./types";

const BOCHA_ENDPOINT = "https://api.bochaai.com/v1/web-search";

export function createBochaProvider(apiKey: string): SearchProvider {
  return {
    name: "bocha",
    async search(query, opts: SearchOptions = {}): Promise<SearchResult[]> {
      const count = opts.maxResults ?? 5;
      const res = await fetch(BOCHA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, count, summary: true }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`bocha HTTP ${res.status}`);
      const data = (await res.json()) as {
        data?: { webPages?: { value?: { name?: string; url?: string; snippet?: string }[] } };
      };
      const values = data.data?.webPages?.value ?? [];
      return values.map((r) => ({
        title: r.name ?? "(无标题)",
        url: r.url ?? "",
        snippet: (r.snippet ?? "").slice(0, 300),
      }));
    },
  };
}
