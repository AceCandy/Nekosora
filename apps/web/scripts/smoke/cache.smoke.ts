/**
 * cache.ts 冒烟测试 —— 验证无 Redis 时走内存 LRU + get/set/wrap 语义。
 * 运行:pnpm tsx scripts/smoke/cache.smoke.ts
 */
import assert from "node:assert";
import {
  cacheDel,
  cacheGet,
  cacheSet,
  cacheWrap,
  __resetCacheForTest,
} from "@/lib/infra/cache";

async function run() {
  // 强制内存模式:清空 REDIS_URL 并重置单例。
  (process.env as Record<string, string>).NODE_ENV = "development";
  delete (process.env as Record<string, string>).REDIS_URL;
  __resetCacheForTest();

  // set/get 往返
  await cacheSet("k1", { a: 1, b: "中文" });
  const v1 = await cacheGet<{ a: number; b: string }>("k1");
  assert.deepStrictEqual(v1, { a: 1, b: "中文" });
  console.log("✓ set/get 往返通过");

  // miss 返回 undefined
  const miss = await cacheGet("not-exist");
  assert.strictEqual(miss, undefined);
  console.log("✓ miss 返回 undefined 通过");

  // wrap:首次调 fetcher,二次命中缓存(fetcher 不再执行)
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { computed: calls };
  };
  const r1 = await cacheWrap("w1", fetcher);
  const r2 = await cacheWrap("w1", fetcher);
  assert.deepStrictEqual(r1, { computed: 1 });
  assert.deepStrictEqual(r2, { computed: 1 }); // 命中缓存,calls 仍为 1
  assert.strictEqual(calls, 1);
  console.log("✓ wrap 缓存命中通过(fetcher 仅调用 1 次)");

  // TTL 过期:设短 TTL 后等待
  await cacheSet("ttl1", "v", 50);
  assert.strictEqual(await cacheGet("ttl1"), "v");
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(await cacheGet("ttl1"), undefined);
  console.log("✓ TTL 过期通过");

  // del
  await cacheSet("d1", "x");
  await cacheDel("d1");
  assert.strictEqual(await cacheGet("d1"), undefined);
  console.log("✓ del 通过");

  console.log("\n全部通过 ✅(内存 LRU 模式)");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
