"use server";
import { eq, asc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { encryptKeyBundle, parseKeyBundle } from "@/lib/providers/keys";
import type { WeightedKey } from "@/lib/providers/keys";
import { probeProviderKey, fetchUpstreamModels, type ProbeResult, type UpstreamModel } from "@/lib/providers/probe";
import { recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import { pickWeightedKey } from "@/lib/providers/keys";
import type { ProviderProtocol } from "@/db/types";
import { requireAdmin } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/**
 * 从 FormData 收集多 key + 权重。
 * 约定字段名:`keys[].key` / `keys[].weight`(也可用 `key` + `weight` 单值,兼容旧表单)。
 * 过滤空 key;weight 缺省/非法 → 1。
 */
function collectKeys(formData: FormData): WeightedKey[] {
  const keys = formData.getAll("keys[].key").map((k) => String(k));
  const weights = formData.getAll("keys[].weight").map((w) => Number(String(w)));
  // 兼容:仅提供了单个 `apiKey` 字段(单 key 场景)
  if (keys.length === 0) {
    const single = String(formData.get("apiKey") ?? "");
    if (single) return [{ key: single, weight: 1 }];
    return [];
  }
  return keys
    .map((key, i) => ({
      key: key.trim(),
      weight: Number.isFinite(weights[i]) && (weights[i] ?? 1) >= 0 ? weights[i] : 1,
    }))
    .filter((k) => k.key.length > 0);
}

// ===================== Providers =====================

export async function listProviders() {
  await requireAdmin();
  const db = await getDb();
  return db.select().from(S().globalProviders).orderBy(S().globalProviders.createdAt);
}

export async function createProvider(formData: FormData) {
  await requireAdmin();
  const db = await getDb();
  const keys = collectKeys(formData);
  if (keys.length === 0) throw new Error("至少需要一个 API Key");
  const apiKeysEnc = encryptKeyBundle(keys);
  await db.insert(S().globalProviders).values({
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKeysEnc,
    keyStrategy: "round_robin",
    enabled: true,
    priority: 0,
  });
  revalidatePath("/admin", "layout");
}

/** 更新 provider(支持改 name/baseUrl/protocol/keys)。keys 为空表示不改 key。 */
export async function updateProvider(id: string, formData: FormData) {
  await requireAdmin();
  const db = await getDb();
  const patch: Record<string, unknown> = {
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    updatedAt: new Date(),
  };
  const keys = collectKeys(formData);
  if (keys.length > 0) {
    patch.apiKeysEnc = encryptKeyBundle(keys);
  }
  await db.update(S().globalProviders).set(patch).where(eq(S().globalProviders.id, id));
  revalidatePath("/admin", "layout");
}

export async function toggleProvider(id: string, enabled: boolean) {
  await requireAdmin();
  const db = await getDb();
  await db.update(S().globalProviders).set({ enabled }).where(eq(S().globalProviders.id, id));
  revalidatePath("/admin", "layout");
}

export async function deleteProvider(id: string) {
  await requireAdmin();
  const db = await getDb();
  await db.delete(S().globalProviders).where(eq(S().globalProviders.id, id));
  revalidatePath("/admin", "layout");
}

/**
 * 直接用原始参数探测密钥连通性(不读 DB)。
 * 用于 KeyBundleEditor 里逐 key 测试:配 key 时(尚未保存)即可验证,
 * 比"先存库再测"更顺手。复用同一套 probe 逻辑。
 */
export async function testKeyDirect(input: {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}): Promise<ProbeResult> {
  await requireAdmin();
  return probeProviderKey({
    protocol: input.protocol as ProviderProtocol,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
  });
}

/** provider 全量密钥健康检测结果(检测所有 key 后返回,UI 展示 X/Y)。 */
export interface ProviderHealthResult {
  healthy: number;
  total: number;
  checkedAt: number;
}

/**
 * 检测全局 provider 的所有 key 健康度,汇总成 X/Y 并落库。
 * 串行逐个探测(避免并发冲击上游),结果写回 provider 表,列表持久展示。
 */
export async function checkProviderHealth(id: string): Promise<ProviderHealthResult> {
  await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().globalProviders)
    .where(eq(S().globalProviders.id, id));
  if (!provider) throw new Error("服务商不存在");

  const keys = parseKeyBundle(provider.apiKeysEnc as string);
  const protocol = provider.protocol as ProviderProtocol;
  const baseUrl = provider.baseUrl as string;
  let healthy = 0;
  for (const k of keys) {
    const result = await probeProviderKey({ protocol, baseUrl, apiKey: k.key });
    if (result.ok) healthy += 1;
  }
  const checkedAt = Date.now();
  await db
    .update(S().globalProviders)
    .set({
      lastHealthCheckedAt: new Date(checkedAt),
      lastHealthyKeyCount: healthy,
      lastTotalKeyCount: keys.length,
      updatedAt: new Date(),
    })
    .where(eq(S().globalProviders.id, id));
  revalidatePath("/admin", "layout");
  return { healthy, total: keys.length, checkedAt };
}

/** 拉取全局 provider 的上游模型列表(直接 fetch /models)。 */
export async function listUpstreamModels(id: string): Promise<UpstreamModel[]> {
  await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().globalProviders)
    .where(eq(S().globalProviders.id, id));
  if (!provider) throw new Error("服务商不存在");
  const keys = parseKeyBundle(provider.apiKeysEnc as string);
  const firstKey = keys[0]?.key ?? "";
  return fetchUpstreamModels({
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: firstKey,
  });
}

/**
 * 测试单条路由的模型可用性(用该 route 的 provider+key+upstreamModelName 发极小请求)。
 * 比单纯验证 key 更进一步:确认"这个 provider 真能跑这个模型"。
 * 结果同步喂养熔断器,让主动测试与被动健康联动。
 */
export async function testRoute(routeId: string): Promise<ProbeResult> {
  await requireAdmin();
  const db = await getDb();
  const [route] = await db
    .select()
    .from(S().globalRoutes)
    .where(eq(S().globalRoutes.id, routeId));
  if (!route) throw new Error("路由不存在");
  const [provider] = await db
    .select()
    .from(S().globalProviders)
    .where(eq(S().globalProviders.id, route.providerId));
  if (!provider) throw new Error("服务商不存在");

  const keys = parseKeyBundle(provider.apiKeysEnc as string);
  const apiKey = pickWeightedKey(keys);
  const providerId = provider.id as string;
  const result = await probeProviderKey({
    protocol: provider.protocol as ProviderProtocol,
    baseUrl: provider.baseUrl,
    apiKey,
    upstreamModelName: route.upstreamModelName as string,
  });
  // 喂养熔断器:成功重置,失败累计。
  if (result.ok) recordSuccess(providerId);
  else recordFailure(providerId);
  return result;
}

// ===================== Models =====================

export async function listModels() {
  await requireAdmin();
  const db = await getDb();
  // sortOrder 为主排序,createdAt 兜底消除「全部为 0」时的无序,与另两处列表对齐。
  return db
    .select()
    .from(S().globalModels)
    .orderBy(asc(S().globalModels.sortOrder), asc(S().globalModels.createdAt));
}

export async function listRoutes() {
  await requireAdmin();
  const db = await getDb();
  return db
    .select({
      route: S().globalRoutes,
      providerName: S().globalProviders.name,
    })
    .from(S().globalRoutes)
    .innerJoin(S().globalProviders, eq(S().globalRoutes.providerId, S().globalProviders.id));
}

export async function createModel(formData: FormData) {
  await requireAdmin();
  const db = await getDb();
  const capsRaw = String(formData.get("capabilities") ?? "{}");
  let capabilities = {};
  try {
    capabilities = JSON.parse(capsRaw);
  } catch {
    /* ignore */
  }
  // 新建模型默认放末尾(sortOrder = 当前 max + 1,空表时从 0 起)。
  const [maxRow] = await db
    .select({ maxSort: sql<number>`coalesce(max(${S().globalModels.sortOrder}), -1)` })
    .from(S().globalModels);
  const nextSort = (maxRow?.maxSort ?? -1) + 1;
  await db.insert(S().globalModels).values({
    name: String(formData.get("name") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    vendor: String(formData.get("vendor") ?? ""),
    capabilities,
    accessScope: String(formData.get("accessScope") ?? "public"),
    enabled: true,
    systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
    sortOrder: nextSort,
  });
  revalidatePath("/admin", "layout");
}

/**
 * 创建路由。modelId 既可由 .bind 前缀传入(新 UI:每模型一个 action),
 * 也可由 FormData 提供(兼容旧表单,字段名 modelId)。
 */
export async function createRoute(modelIdOrFormData: string | FormData, formData?: FormData) {
  await requireAdmin();
  const db = await getDb();
  const fd = typeof modelIdOrFormData === "string" ? formData! : modelIdOrFormData;
  const modelId =
    typeof modelIdOrFormData === "string" ? modelIdOrFormData : String(fd.get("modelId") ?? "");
  await db.insert(S().globalRoutes).values({
    modelId,
    providerId: String(fd.get("providerId") ?? ""),
    upstreamModelName: String(fd.get("upstreamModelName") ?? ""),
    priority: Number(fd.get("priority") ?? 0),
    weight: Number(fd.get("weight") ?? 1),
    enabled: true,
  });
  revalidatePath("/admin", "layout");
}

/** 更新模型(支持改全部展示/能力字段)。 */
export async function updateModel(id: string, formData: FormData) {
  await requireAdmin();
  const db = await getDb();
  const capsRaw = String(formData.get("capabilities") ?? "{}");
  let capabilities = {};
  try {
    capabilities = JSON.parse(capsRaw);
  } catch {
    /* ignore */
  }
  await db
    .update(S().globalModels)
    .set({
      name: String(formData.get("name") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      vendor: String(formData.get("vendor") ?? "") || null,
      accessScope: String(formData.get("accessScope") ?? "public"),
      systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
      capabilities,
      updatedAt: new Date(),
    })
    .where(eq(S().globalModels.id, id));
  revalidatePath("/admin", "layout");
}

export async function deleteModel(id: string) {
  await requireAdmin();
  const db = await getDb();
  // globalRoutes 对 globalModels 有 onDelete: cascade,路由会自动级联删除。
  await db.delete(S().globalModels).where(eq(S().globalModels.id, id));
  revalidatePath("/admin", "layout");
}

/**
 * 拖动重排:按拖动后的完整顺序全表重写 sortOrder 为连续整数 0,1,2…
 * 单事务包裹,中途失败整体回滚。id 不存在自然跳过(update 0 行),不抛错。
 */
export async function reorderModels(orderedIds: string[]) {
  await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(S().globalModels).set({ sortOrder: i }).where(eq(S().globalModels.id, orderedIds[i]));
    }
  });
  revalidatePath("/admin", "layout");
}

/** 更新路由。modelId 不可改(路由归属模型固定)。 */
export async function updateRoute(id: string, formData: FormData) {
  await requireAdmin();
  const db = await getDb();
  await db
    .update(S().globalRoutes)
    .set({
      providerId: String(formData.get("providerId") ?? ""),
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
      priority: Number(formData.get("priority") ?? 0),
      weight: Number(formData.get("weight") ?? 1),
    })
    .where(eq(S().globalRoutes.id, id));
  revalidatePath("/admin", "layout");
}

export async function deleteRoute(id: string) {
  await requireAdmin();
  const db = await getDb();
  await db.delete(S().globalRoutes).where(eq(S().globalRoutes.id, id));
  revalidatePath("/admin", "layout");
}

export async function toggleRoute(id: string, enabled: boolean) {
  await requireAdmin();
  const db = await getDb();
  await db.update(S().globalRoutes).set({ enabled }).where(eq(S().globalRoutes.id, id));
  revalidatePath("/admin", "layout");
}

export async function toggleModel(id: string, enabled: boolean) {
  await requireAdmin();
  const db = await getDb();
  await db.update(S().globalModels).set({ enabled }).where(eq(S().globalModels.id, id));
  revalidatePath("/admin", "layout");
}

// ===================== Users =====================

export async function listUsers() {
  await requireAdmin();
  const db = await getDb();
  return db.select().from(S().user).orderBy(S().user.createdAt);
}

export async function toggleUserStatus(id: string, status: string) {
  await requireAdmin();
  const db = await getDb();
  await db.update(S().user).set({ status }).where(eq(S().user.id, id));
  revalidatePath("/admin", "layout");
}
