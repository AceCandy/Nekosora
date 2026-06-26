/**
 * 联网搜索 registry —— 按 system_settings(namespace="web_search") 选择 provider。
 *
 * 配置项(key):
 *   provider: "tavily" | "bocha" | "zhipu"(默认 tavily)
 *   api_key:  对应 provider 的密钥
 *   model:    仅 zhipu 用(默认 glm-4-plus)
 *
 * 未配置 api_key 时返回 null(上层据此判定功能不可用)。
 */
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import type { SearchProvider } from "./types";
import { createTavilyProvider } from "./tavily";
import { createBochaProvider } from "./bocha";
import { createZhipuProvider } from "./zhipu";

interface WebSearchConfig {
  provider: string;
  apiKey: string;
  model?: string;
}

let _cached: { config: WebSearchConfig | null; ts: number } | null = null;
const TTL = 60_000;

/** 读取 web_search 配置(带 60s 缓存)。 */
async function loadConfig(): Promise<WebSearchConfig | null> {
  if (_cached && Date.now() - _cached.ts < TTL) return _cached.config;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select({ key: s.systemSettings.key, value: s.systemSettings.value })
    .from(s.systemSettings)
    .where(eq(s.systemSettings.namespace, "web_search"));
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.key)] = String(r.value);
  const provider = map.provider || "tavily";
  const apiKey = map.api_key || "";
  const config = apiKey ? { provider, apiKey, model: map.model || undefined } : null;
  _cached = { config, ts: Date.now() };
  return config;
}

/** 构造当前配置的 provider 实例;未配置返回 null。 */
export async function resolveProvider(): Promise<SearchProvider | null> {
  const config = await loadConfig();
  if (!config) return null;
  switch (config.provider) {
    case "bocha":
      return createBochaProvider(config.apiKey);
    case "zhipu":
      return createZhipuProvider(config.apiKey, config.model);
    case "tavily":
    default:
      return createTavilyProvider(config.apiKey);
  }
}

/** web_search 是否已启用(api_key 已配置)。 */
export async function isWebSearchEnabled(): Promise<boolean> {
  const config = await loadConfig();
  return config !== null;
}

/** 清除配置缓存(管理员更新设置后调用)。 */
export function clearWebSearchConfigCache(): void {
  _cached = null;
}
