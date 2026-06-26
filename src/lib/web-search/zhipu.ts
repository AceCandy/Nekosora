/**
 * 智谱 WebSearch 适配器 —— 走 BigModel 的 web_search 工具接口。
 *
 * 约定:system_settings(namespace="web_search") 配置:
 *   provider="zhipu" / api_key=<BigModel key> / model=<可选,默认 glm-4-plus>
 *
 * 实现:调用智谱 tools API,触发 web_search 工具,从返回的 search_result 提取链接与摘要。
 */
import type { SearchProvider, SearchResult, SearchOptions } from "./types";

const ZHIPU_TOOLS_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/tools";

interface ZhipuSearchItem {
  title?: string;
  link?: string;
  content?: string;
  media?: string;
}

export function createZhipuProvider(apiKey: string, model = "glm-4-plus"): SearchProvider {
  return {
    name: "zhipu",
    async search(query, opts: SearchOptions = {}): Promise<SearchResult[]> {
      const res = await fetch(ZHIPU_TOOLS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          tool: "web-search",
          messages: [{ role: "user", content: query }],
          model,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`zhipu HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { tool_calls?: { search_result?: ZhipuSearchItem[] }[] } }[] };
      const items =
        data.choices?.[0]?.message?.tool_calls?.flatMap((tc) => tc.search_result ?? []) ?? [];
      return items.slice(0, opts.maxResults ?? 5).map((r) => ({
        title: r.title ?? "(无标题)",
        url: r.link ?? "",
        snippet: (r.content ?? "").slice(0, 300),
      }));
    },
  };
}
