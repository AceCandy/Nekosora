/**
 * 缓存降级 —— Redis(配了 REDIS_URL)或进程内内存 LRU(默认)。
 *
 * 基于 cache-manager v6(Keyv)。stores 数组:读时自上而下穿透,写时扇出到全部。
 * 配了 Redis 时为 [Redis, 内存] 两级(内存作热缓存兜底);否则仅 [内存]。
 *
 * TTL 单位为毫秒(v6 约定)。
 */
import { createCache, type Cache as CmCache } from "cache-manager";
import Keyv from "keyv";
import KeyvRedis from "@keyv/redis";

export type Cache = CmCache;

let _cache: Cache | null = null;

function buildCache(): Cache {
  const stores: Keyv[] = [];
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // 顶层 Redis(命名空间隔离),兜底内存 —— 写扇出,读先 Redis 后内存。
    stores.push(new Keyv({ store: new KeyvRedis(redisUrl), namespace: "nekusora" }));
  }
  // 内存 store 总是存在(无论是否有 Redis,都作为最近的热缓存)。
  stores.push(new Keyv({ namespace: "nekusora:mem" }));

  return createCache({ stores, ttl: 60_000 });
}

/** 获取单例 cache。 */
export function getCache(): Cache {
  if (!_cache) _cache = buildCache();
  return _cache;
}

/** 测试用:重置单例(切换配置后)。 */
export function __resetCacheForTest(): void {
  _cache = null;
}

// 导出常用操作快捷函数 —— 统一 TTL 毫秒语义。
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const v = await getCache().get<T>(key);
  // Keyv 在 miss 时返回 undefined 或 null,统一为 undefined。
  return v ?? undefined;
}

export async function cacheSet(key: string, value: unknown, ttlMs?: number): Promise<void> {
  await getCache().set(key, value, ttlMs);
}

export async function cacheDel(key: string): Promise<void> {
  await getCache().del(key);
}

/** get-or-fetch:命中直接返回;未命中调 fetcher 并写入,再返回。 */
export async function cacheWrap<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const v = await getCache().wrap<T>(key, fetcher, ttlMs);
  return v;
}
