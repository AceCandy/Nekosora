/**
 * 联网搜索统一入口。
 *
 * searchWeb(query):
 *   - 通过 registry 解析当前 provider
 *   - 带缓存(相同 query 60s 内复用)与超时保护
 *   - 返回归一化的 SearchBundle,供 chat route 注入 system + 发 SSE 引用事件
 *
 * 失败不抛错,返回 hit:false(上层据此跳过引用注入,不阻断主对话流)。
 */
import { cacheWrap } from "@/lib/infra/cache";
import { resolveProvider } from "./registry";
import type { SearchBundle } from "./types";

const MAX_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 8000;

/** 执行一次联网搜索(带缓存)。未配置 provider 时返回 hit:false。 */
export async function searchWeb(query: string): Promise<SearchBundle> {
  const provider = await resolveProvider();
  if (!provider) return { results: [], hit: false, reason: "未配置 web_search provider" };

  try {
    const results = await cacheWrap(
      `websearch:${provider.name}:${query}`,
      () => withTimeout(provider.search(query, { maxResults: MAX_RESULTS }), SEARCH_TIMEOUT_MS),
      60_000,
    );
    if (results.length === 0) return { results: [], hit: false, reason: "无搜索结果" };
    return { results, hit: true };
  } catch (err) {
    return {
      results: [],
      hit: false,
      reason: err instanceof Error ? err.message : "搜索失败",
    };
  }
}

/** 给 promise 加超时保护。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("搜索超时")), ms),
    ),
  ]);
}

/**
 * 把搜索结果渲染为 system 注入文本(供模型作为参考上下文)。
 * 正文按编号引用 [1] [2]...,模型可在回答中引用这些编号。
 */
export function renderSearchContext(results: { title: string; url: string; snippet: string }[]): string {
  if (results.length === 0) return "";
  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`,
  );
  return `以下是联网搜索到的参考资料,可在回答中用 [编号] 引用:\n\n${lines.join("\n\n")}`;
}
