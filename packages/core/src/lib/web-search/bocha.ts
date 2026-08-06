import { z } from "zod";
import type { SearchProvider } from "./types";
import { SearchProviderError } from "./types";

const BOCHA_ENDPOINT = "https://api.bochaai.com/v1/web-search";
const responseSchema = z.object({
  data: z.object({
    webPages: z.object({
      value: z.array(z.object({
        name: z.string().optional(),
        url: z.string().optional(),
        snippet: z.string().optional(),
      })).optional(),
    }).optional(),
  }).optional(),
});

export function createBochaProvider(apiKey: string): SearchProvider {
  return {
    name: "bocha",
    async search(query, opts = {}) {
      const res = await fetch(BOCHA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, count: opts.maxResults ?? 5, summary: true }),
        signal: opts.signal,
      });
      if (!res.ok) throw new SearchProviderError(`bocha HTTP ${res.status}`, res.status);
      const data = responseSchema.parse(await res.json());
      return (data.data?.webPages?.value ?? []).map((item) => ({
        title: item.name ?? "(无标题)",
        url: item.url ?? "",
        snippet: item.snippet ?? "",
      }));
    },
  };
}
