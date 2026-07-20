/**
 * 联网搜索 registry -- 按 per-user 配置(user_settings key=web_search)选择 provider。
 *
 * 配置 JSON 结构见 WebSearchConfig:providers 数组,取首个 enabled 的构造实例。
 * 支持 tavily / bocha / zhipu / searxng;未配置或无 enabled 时返回 null。
 *
 * per-user 缓存(60s TTL),保存后主动失效。
 */
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import type { SearchProvider, WebSearchConfig, WebSearchProviderConfig } from "./types";
import { createTavilyProvider } from "./tavily";
import { createBochaProvider } from "./bocha";
import { createZhipuProvider } from "./zhipu";
import { createSearxngProvider } from "./searxng";

const WEB_SEARCH_KEY = "web_search";
const TTL = 60_000;

// per-user 配置缓存:userId -> {config, ts}。
const _cache = new Map<string, { config: WebSearchConfig | null; ts: number }>();

/** 读取用户的联网搜索配置(带 60s 缓存)。无配置返回 null。 */
export async function loadConfig(userId: string): Promise<WebSearchConfig | null> {
  const cached = _cache.get(userId);
  if (cached && Date.now() - cached.ts < TTL) return cached.config;
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select({ value: s.userSettings.value })
    .from(s.userSettings)
    .where(and(eq(s.userSettings.userId, userId), eq(s.userSettings.key, WEB_SEARCH_KEY)))
    .limit(1);
  let config: WebSearchConfig | null = null;
  const raw = rows[0]?.value;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WebSearchConfig;
      if (parsed && Array.isArray(parsed.providers)) config = parsed;
    } catch {
      config = null;
    }
  }
  _cache.set(userId, { config, ts: Date.now() });
  return config;
}

/** 按 type 构造 provider 实例;缺少必填字段返回 null。 */
function buildProvider(p: WebSearchProviderConfig): SearchProvider | null {
  switch (p.type) {
    case "tavily":
      return p.apiKey ? createTavilyProvider(p.apiKey) : null;
    case "bocha":
      return p.apiKey ? createBochaProvider(p.apiKey) : null;
    case "zhipu":
      return p.apiKey ? createZhipuProvider(p.apiKey, p.model) : null;
    case "searxng":
      return p.baseUrl ? createSearxngProvider(p.baseUrl) : null;
    default:
      return null;
  }
}

/** 构造当前用户的 provider 实例(取首个 enabled);未配置/无 enabled 返回 null。 */
export async function resolveProvider(userId: string): Promise<SearchProvider | null> {
  const config = await loadConfig(userId);
  if (!config) return null;
  const enabled = config.providers.find((p) => p.enabled);
  if (!enabled) return null;
  return buildProvider(enabled);
}

/** web_search 是否已启用(至少一个 enabled provider 且必填字段齐全)。 */
export async function isWebSearchEnabled(userId: string): Promise<boolean> {
  const config = await loadConfig(userId);
  if (!config) return false;
  const enabled = config.providers.find((p) => p.enabled);
  return enabled ? buildProvider(enabled) !== null : false;
}

/** 清除配置缓存:传 userId 清该用户,不传清全部。保存后调用。 */
export function clearWebSearchConfigCache(userId?: string): void {
  if (userId) _cache.delete(userId);
  else _cache.clear();
}

/** 写入用户的联网搜索配置(upsert user_settings),并清该用户缓存。 */
export async function saveWebSearchConfig(userId: string, config: WebSearchConfig): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db
    .insert(s.userSettings)
    .values({ userId, key: WEB_SEARCH_KEY, value: JSON.stringify(config) })
    .onConflictDoUpdate({
      target: [s.userSettings.userId, s.userSettings.key],
      set: { value: JSON.stringify(config), updatedAt: new Date() },
    });
  clearWebSearchConfigCache(userId);
}
