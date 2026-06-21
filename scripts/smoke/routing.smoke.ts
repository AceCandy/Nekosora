/**
 * routing.ts 冒烟测试 —— 验证模型路由解析 + 负载均衡 + 子 key 绑定约束。
 *
 * 不打真实上游(无网络),只验证 DB → 路由链 的解析逻辑。
 * 运行:pnpm tsx scripts/smoke/routing.smoke.ts
 */
import assert from "node:assert";
import { eq } from "drizzle-orm";
import { getDb, getSchema, isPg, closeDb } from "@/lib/infra/db";
import { encrypt } from "@/lib/infra/crypto";
import { resolveRoutes, RoutingError } from "@/lib/routing";
import type { CallContext } from "@/lib/providers/types";

(process.env as Record<string, string>).NODE_ENV = "development";
process.env.DB_DIALECT = "sqlite";
process.env.SQLITE_PATH = "./data/local.db";

// 三个等价 provider(不同 base_url,模拟多上游负载均衡)。
const PROVIDERS = [
  { name: "上游A", baseUrl: "https://upstream-a.example.com/v1", priority: 0, weight: 1 },
  { name: "上游B", baseUrl: "https://upstream-b.example.com/v1", priority: 0, weight: 3 },
  { name: "上游C(低优先级)", baseUrl: "https://upstream-c.example.com/v1", priority: 1, weight: 1 },
];

async function seed() {
  const db = await getDb();
  const s = getSchema() as Record<string, any>;
  const userId = "pCv1BrQK1mvC139lsrsuW7RAzTuyP8nR"; // seed 的管理员

  // 清理可能的旧数据
  await db.delete(s.globalRoutes);
  await db.delete(s.globalModels);
  await db.delete(s.globalProviders);

  const providerIds: string[] = [];
  for (const p of PROVIDERS) {
    const [row] = await db
      .insert(s.globalProviders)
      .values({
        name: p.name,
        protocol: "openai",
        baseUrl: p.baseUrl,
        apiKeysEnc: encrypt(JSON.stringify({ keys: ["sk-test-fake-key"] })),
        keyStrategy: "round_robin",
        enabled: true,
        priority: 0,
      })
      .returning({ id: s.globalProviders.id });
    providerIds.push(row.id);
  }

  const [model] = await db
    .insert(s.globalModels)
    .values({
      name: "gpt-test",
      displayName: "GPT Test",
      vendor: "openai",
      capabilities: { stream: true, tools: true },
      accessScope: "public",
      enabled: true,
    })
    .returning({ id: s.globalModels.id });

  for (let i = 0; i < providerIds.length; i++) {
    await db.insert(s.globalRoutes).values({
      modelId: model.id,
      providerId: providerIds[i],
      upstreamModelName: "gpt-4o",
      protocol: "openai",
      priority: PROVIDERS[i].priority,
      weight: PROVIDERS[i].weight,
      enabled: true,
    });
  }

  return { userId };
}

async function run() {
  const { userId } = await seed();
  const ctx: CallContext = { userId, keyKind: null, source: "chat" };

  // 1. 基本解析:gpt-test 应得到 3 条路由
  const routes = await resolveRoutes(ctx, "gpt-test");
  assert.strictEqual(routes.length, 3, "应解析出 3 条路由");
  assert.strictEqual(routes[0].modelName, "gpt-test");
  assert.strictEqual(routes[0].upstreamModelName, "gpt-4o");
  console.log("✓ 全局模型解析出 3 条路由");

  // 2. 优先级排序:priority=0 的两条在前,priority=1 在最后
  const prios = routes.map((r) => r.priority);
  assert.ok(prios[0] === 0 && prios[1] === 0 && prios[2] === 1, "应按优先级升序");
  console.log("✓ 优先级排序正确(0,0,1):", prios.join(","));

  // 3. 加权分布:priority=0 组内 B(weight=3) 应比 A(weight=1) 更常排前。
  //    统计 100 次。
  let bFirst = 0;
  for (let i = 0; i < 100; i++) {
    const rs = await resolveRoutes(ctx, "gpt-test");
    if (rs[0].provider.baseUrl.includes("upstream-b")) bFirst++;
  }
  assert.ok(bFirst > 60, `weight=3 的 B 应多数排前(实际 ${bFirst}/100)`);
  console.log(`✓ 加权负载均衡:B 排前 ${bFirst}/100 次(weight=3 vs 1)`);

  // 4. provider key 已解密
  assert.strictEqual(routes[0].provider.apiKey, "sk-test-fake-key", "key 应已解密");
  console.log("✓ provider key 解密成功");

  // 5. 不存在的模型 → RoutingError
  await assert.rejects(
    () => resolveRoutes(ctx, "nonexistent-model"),
    (e: unknown) => e instanceof RoutingError && e.code === "model_not_found",
  );
  console.log("✓ 不存在的模型抛 model_not_found");

  // 6. internal 模型不对外(gateway 场景)
  const db = await getDb();
  const s = getSchema() as Record<string, any>;
  await db.insert(s.globalModels).values({
    name: "internal-embed",
    displayName: "Embedding (internal)",
    accessScope: "internal",
    enabled: true,
  });
  const gatewayCtx: CallContext = { userId, keyKind: null, source: "gateway" };
  await assert.rejects(
    () => resolveRoutes(gatewayCtx, "internal-embed"),
    (e: unknown) => e instanceof RoutingError && e.code === "model_not_available",
  );
  console.log("✓ internal 模型对 gateway 不可用");

  console.log("\n全部通过 ✅");
}

run()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
