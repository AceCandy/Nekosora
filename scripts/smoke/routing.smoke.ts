/**
 * routing.ts 冒烟测试 —— 验证模型路由解析 + 负载均衡 + 子 key 绑定约束。
 *
 * 不打真实上游(无网络),只验证 DB → 路由链 的解析逻辑。
 * 运行:pnpm tsx scripts/smoke/routing.smoke.ts
 */
import assert from "node:assert";
import { eq } from "drizzle-orm";
import { getDb, getSchema, closeDb } from "@/lib/infra/db";
import { encrypt } from "@/lib/infra/crypto";
import { resolveRoutes, resolveRoutesById, RoutingError } from "@/lib/routing";
import type { CallContext } from "@/lib/providers/types";

(process.env as Record<string, string>).NODE_ENV = "development";
// 依赖 DATABASE_URL(PostgreSQL);运行前需 docker compose up postgres + pnpm db:migrate:pg。
if (!process.env.DATABASE_URL) {
  console.error("[smoke] 缺少 DATABASE_URL,无法运行(仅支持 PostgreSQL)。");
  process.exit(1);
}

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

  // 清理可能的旧数据(顺序:先删引用方 routes,再删 models/providers)
  await db.delete(s.routes);
  await db.delete(s.models);
  await db.delete(s.providers);

  const providerIds: string[] = [];
  for (const p of PROVIDERS) {
    const [row] = await db
      .insert(s.providers)
      .values({
        ownerUserId: userId,
        name: p.name,
        protocol: "openai",
        baseUrl: p.baseUrl,
        apiKeysEnc: encrypt(JSON.stringify({ keys: ["sk-test-fake-key"] })),
        keyStrategy: "round_robin",
        enabled: true,
        priority: 0,
      })
      .returning({ id: s.providers.id });
    providerIds.push(row.id);
  }

  const [model] = await db
    .insert(s.models)
    .values({
      ownerUserId: userId,
      visibility: "public",
      name: "gpt-test",
      displayName: "GPT Test",
      vendor: "openai",
      capabilities: { stream: true, tools: true },
      enabled: true,
    })
    .returning({ id: s.models.id });

  for (let i = 0; i < providerIds.length; i++) {
    await db.insert(s.routes).values({
      ownerUserId: userId,
      modelId: model.id,
      providerId: providerIds[i],
      upstreamModelName: "gpt-4o",
      priority: PROVIDERS[i].priority,
      weight: PROVIDERS[i].weight,
      enabled: true,
    });
  }

  return { userId, modelId: model.id };
}

async function run() {
  const { userId, modelId } = await seed();
  const ctx: CallContext = { userId, keyKind: null, source: "gateway" };

  // 1. 基本解析:gpt-test 应得到 3 条路由(网关 owner-only by name)
  const routes = await resolveRoutes(ctx, "gpt-test");
  assert.strictEqual(routes.length, 3, "应解析出 3 条路由");
  assert.strictEqual(routes[0].modelName, "gpt-test");
  assert.strictEqual(routes[0].upstreamModelName, "gpt-4o");
  console.log("✓ 网关按 name 解析出 3 条路由(owner-only)");

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

  // 6. 网关 owner-only:他人 private 模型对网关不可见(by name 查不到)
  const db = await getDb();
  const s = getSchema() as Record<string, any>;
  const otherUserId = "smoke-other-user-0000000000000001";
  await db.insert(s.user).values({
    id: otherUserId,
    name: "Smoke Other",
    email: "smoke-other@nekusora.local",
  });
  await db.insert(s.models).values({
    ownerUserId: otherUserId,
    visibility: "private",
    name: "other-private-model",
    enabled: true,
  });
  await assert.rejects(
    () => resolveRoutes(ctx, "other-private-model"),
    (e: unknown) => e instanceof RoutingError && e.code === "model_not_found",
  );
  console.log("✓ 网关 owner-only:他人 private 模型不可见(model_not_found)");

  // 7. WebChat byId:public 模型任意人可见(resolveRoutesById)
  const otherCtx: CallContext = { userId: otherUserId, keyKind: null, source: "chat" };
  const byIdRoutes = await resolveRoutesById(otherCtx, modelId);
  assert.strictEqual(byIdRoutes.length, 3, "WebChat byId 应解析出 3 条路由");
  assert.strictEqual(byIdRoutes[0].source, "global", "public 模型 source=global");
  console.log("✓ WebChat byId:public 模型对他用户可见(source=global)");

  // 8. WebChat byId:他人 private 模型不可见
  const [otherModel] = await db
    .select({ id: s.models.id })
    .from(s.models)
    .where(eq(s.models.name, "other-private-model"))
    .limit(1);
  await assert.rejects(
    () => resolveRoutesById(ctx, otherModel.id),
    (e: unknown) => e instanceof RoutingError && e.code === "model_not_found",
  );
  console.log("✓ WebChat byId:他人 private 模型不可见(model_not_found)");

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
