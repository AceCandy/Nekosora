import { z } from "zod";
import type { SearchProvider } from "./types";
import { SearchProviderError } from "./types";

const ZHIPU_TOOLS_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/tools";
const responseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      tool_calls: z.array(z.object({
        search_result: z.array(z.object({
          title: z.string().optional(),
          link: z.string().optional(),
          content: z.string().optional(),
        })).optional(),
      })).optional(),
    }).optional(),
  })).optional(),
});

export function createZhipuProvider(apiKey: string, model = "glm-4-plus"): SearchProvider {
  return {
    name: "zhipu",
    async search(query, opts = {}) {
      const res = await fetch(ZHIPU_TOOLS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          tool: "web-search",
          messages: [{ role: "user", content: query }],
          model,
        }),
        signal: opts.signal,
      });
      if (!res.ok) throw new SearchProviderError(`zhipu HTTP ${res.status}`, res.status);
      const data = responseSchema.parse(await res.json());
      const items = data.choices?.[0]?.message?.tool_calls?.flatMap((call) => call.search_result ?? []) ?? [];
      return items.slice(0, opts.maxResults ?? 5).map((item) => ({
        title: item.title ?? "(无标题)",
        url: item.link ?? "",
        snippet: item.content ?? "",
      }));
    },
  };
}
