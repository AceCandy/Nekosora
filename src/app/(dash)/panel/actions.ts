"use server";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { encryptKeyBundle, parseKeyBundle, pickWeightedKey } from "@/lib/providers/keys";
import type { WeightedKey } from "@/lib/providers/keys";
import { probeProviderKey, fetchUpstreamModels, type ProbeResult, type UpstreamModel } from "@/lib/providers/probe";
import { recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import type { ProviderProtocol } from "@/db/types";
import { requireSession } from "@/lib/session";
import {
  createMasterKey,
  createSubKey,
  listKeys,
  setKeyEnabled,
} from "@/lib/keys";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

// ===================== Keys =====================

export async function getMyKeys() {
  const user = await requireSession();
  return listKeys(user.id);
}

export async function ensureMasterKey() {
  const user = await requireSession();
  try {
    const key = await createMasterKey(user.id, "主密钥");
    revalidatePath("/panel", "layout");
    return { key, error: null };
  } catch {
    return { key: null, error: "主密钥已存在" };
  }
}

export async function newSubKey(name: string) {
  const user = await requireSession();
  const key = await createSubKey(user.id, name);
  revalidatePath("/panel", "layout");
  return key;
}

export async function disableKey(keyId: string) {
  await requireSession();
  await setKeyEnabled(keyId, false);
  revalidatePath("/panel", "layout");
}

// ===================== Sub-key model bindings =====================

export async function getBindings(keyId: string) {
  await requireSession();
  const db = await getDb();
  return db.select().from(S().keyModelBindings).where(eq(S().keyModelBindings.keyId, keyId));
}

export async function bindModel(
  keyId: string,
  scope: "global" | "byo",
  modelId: string,
) {
  await requireSession();
  const db = await getDb();
  await db.insert(S().keyModelBindings).values({
    keyId,
    scope,
    globalModelId: scope === "global" ? modelId : null,
    userModelId: scope === "byo" ? modelId : null,
  });
  revalidatePath("/panel", "layout");
}

export async function unbindBinding(bindingId: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(S().keyModelBindings).where(eq(S().keyModelBindings.id, bindingId));
  revalidatePath("/panel", "layout");
}

// ===================== BYO Providers =====================

export async function getMyProviders() {
  const user = await requireSession();
  const db = await getDb();
  return db
    .select()
    .from(S().userProviders)
    .where(eq(S().userProviders.userId, user.id));
}

export async function createMyProvider(formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  // 收集多 key(与 admin 一致),空则报错。
  const rawKeys = formData.getAll("keys[].key").map((k) => String(k));
  const rawWeights = formData.getAll("keys[].weight").map((w) => Number(String(w)));
  let keys: WeightedKey[];
  if (rawKeys.length > 0) {
    keys = rawKeys
      .map((key, i) => ({
        key: key.trim(),
        weight: Number.isFinite(rawWeights[i]) && (rawWeights[i] ?? 1) >= 0 ? rawWeights[i] : 1,
      }))
      .filter((k) => k.key.length > 0);
  } else {
    // 兼容单个 apiKey 字段
    const single = String(formData.get("apiKey") ?? "").trim();
    keys = single ? [{ key: single, weight: 1 }] : [];
  }
  if (keys.length === 0) throw new Error("至少需要一个 API Key");
  await db.insert(S().userProviders).values({
    userId: user.id,
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKeyEnc: encryptKeyBundle(keys),
    enabled: true,
  });
  revalidatePath("/panel", "layout");
}

/** 删除 BYO provider。 */
export async function deleteMyProvider(id: string) {
  const user = await requireSession();
  const db = await getDb();
  // 校验归属:只能删自己的。
  await db
    .delete(S().userProviders)
    .where(and(eq(S().userProviders.id, id), eq(S().userProviders.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 启用/禁用 BYO provider。 */
export async function toggleMyProvider(id: string, enabled: boolean) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .update(S().userProviders)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(S().userProviders.id, id), eq(S().userProviders.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/**
 * 直接用原始参数探测密钥连通性(不读 DB,校验已登录)。
 * 用于 KeyBundleEditor 里逐 key 测试:配 key 时(尚未保存)即可验证。
 */
export async function testMyKeyDirect(input: {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}): Promise<ProbeResult> {
  await requireSession();
  return probeProviderKey({
    protocol: input.protocol as ProviderProtocol,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
  });
}

/**
 * 检测 BYO provider 的所有 key 健康度(校验归属),汇总 X/Y 并落库。
 */
export async function checkMyProviderHealth(id: string): Promise<{
  healthy: number;
  total: number;
  checkedAt: number;
}> {
  const user = await requireSession();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().userProviders)
    .where(and(eq(S().userProviders.id, id), eq(S().userProviders.userId, user.id)));
  if (!provider) throw new Error("服务商不存在");

  const keys = parseKeyBundle(provider.apiKeyEnc as string);
  const protocol = provider.protocol as ProviderProtocol;
  const baseUrl = provider.baseUrl as string;
  let healthy = 0;
  for (const k of keys) {
    const result = await probeProviderKey({ protocol, baseUrl, apiKey: k.key });
    if (result.ok) healthy += 1;
  }
  const checkedAt = Date.now();
  await db
    .update(S().userProviders)
    .set({
      lastHealthCheckedAt: new Date(checkedAt),
      lastHealthyKeyCount: healthy,
      lastTotalKeyCount: keys.length,
      updatedAt: new Date(),
    })
    .where(and(eq(S().userProviders.id, id), eq(S().userProviders.userId, user.id)));
  revalidatePath("/panel", "layout");
  return { healthy, total: keys.length, checkedAt };
}

/** 拉取 BYO provider 的上游模型列表(校验归属,仅限自己的)。 */
export async function listMyUpstreamModels(id: string): Promise<UpstreamModel[]> {
  const user = await requireSession();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().userProviders)
    .where(and(eq(S().userProviders.id, id), eq(S().userProviders.userId, user.id)));
  if (!provider) throw new Error("服务商不存在");
  const keys = parseKeyBundle(provider.apiKeyEnc as string);
  const firstKey = keys[0]?.key ?? "";
  return fetchUpstreamModels({
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: firstKey,
  });
}

/**
 * 更新 BYO provider(name/baseUrl/protocol/keys)。
 * keys 为空表示不改 key(只改其他字段)。
 */
export async function updateMyProvider(id: string, formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const rawKeys = formData.getAll("keys[].key").map((k) => String(k));
  const rawWeights = formData.getAll("keys[].weight").map((w) => Number(String(w)));
  const keys: WeightedKey[] = rawKeys
    .map((key, i) => ({
      key: key.trim(),
      weight: Number.isFinite(rawWeights[i]) && (rawWeights[i] ?? 1) >= 0 ? rawWeights[i] : 1,
    }))
    .filter((k) => k.key.length > 0);

  const patch: Record<string, unknown> = {
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    updatedAt: new Date(),
  };
  if (keys.length > 0) {
    patch.apiKeyEnc = encryptKeyBundle(keys);
  }
  await db
    .update(S().userProviders)
    .set(patch)
    .where(and(eq(S().userProviders.id, id), eq(S().userProviders.userId, user.id)));
  revalidatePath("/panel", "layout");
}

// ===================== BYO Models =====================

/**
 * 列出我的模型,每个模型附带其路由链(供前端组装 routeItems)。
 * 路由信息移到 user_routes 后,model 行不再依赖 provider(providerName 进 route)。
 */
export async function getMyModels() {
  const user = await requireSession();
  const db = await getDb();
  const [models, routes] = await Promise.all([
    db.select().from(S().userModels).where(eq(S().userModels.userId, user.id)),
    db
      .select({ route: S().userRoutes, providerName: S().userProviders.name })
      .from(S().userRoutes)
      .innerJoin(S().userProviders, eq(S().userRoutes.providerId, S().userProviders.id))
      .where(eq(S().userRoutes.userId, user.id)),
  ]);
  // 按 userModelId 聚合路由。
  const routesByModel = new Map<string, unknown[]>();
  for (const r of routes) {
    const key = (r.route as Record<string, unknown>).userModelId as string;
    const arr = routesByModel.get(key) ?? [];
    arr.push(r);
    routesByModel.set(key, arr);
  }
  return models.map((m: Record<string, unknown>) => ({
    model: m,
    routes: routesByModel.get((m.id as string) ?? "") ?? [],
  }));
}

export async function createMyModel(formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const capsRaw = String(formData.get("capabilities") ?? "{}");
  let capabilities = {};
  try {
    capabilities = JSON.parse(capsRaw);
  } catch {
    /* ignore */
  }
  await db.insert(S().userModels).values({
    userId: user.id,
    name: String(formData.get("name") ?? ""),
    displayName: String(formData.get("displayName") ?? "") || null,
    vendor: String(formData.get("vendor") ?? "") || null,
    systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
    capabilities,
    enabled: true,
  });
  revalidatePath("/panel", "layout");
}

/** 更新 BYO 模型(校验归属)。provider/upstreamModelName 改由路由管理。 */
export async function updateMyModel(id: string, formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const capsRaw = String(formData.get("capabilities") ?? "{}");
  let capabilities = {};
  try {
    capabilities = JSON.parse(capsRaw);
  } catch {
    /* ignore */
  }
  await db
    .update(S().userModels)
    .set({
      name: String(formData.get("name") ?? ""),
      displayName: String(formData.get("displayName") ?? "") || null,
      vendor: String(formData.get("vendor") ?? "") || null,
      systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
      description: String(formData.get("description") ?? "") || null,
      capabilities,
    })
    .where(and(eq(S().userModels.id, id), eq(S().userModels.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 删除 BYO 模型(校验归属)。 */
export async function deleteMyModel(id: string) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .delete(S().userModels)
    .where(and(eq(S().userModels.id, id), eq(S().userModels.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 启停 BYO 模型。 */
export async function toggleMyModel(id: string, enabled: boolean) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .update(S().userModels)
    .set({ enabled })
    .where(and(eq(S().userModels.id, id), eq(S().userModels.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 可供子 key 绑定的模型列表:全局 public ∪ 我的 BYO。 */
export async function getBindableModels() {
  const user = await requireSession();
  const db = await getDb();
  const [globals, byos] = await Promise.all([
    db
      .select()
      .from(S().globalModels)
      .where(and(eq(S().globalModels.accessScope, "public"), eq(S().globalModels.enabled, true))),
    db
      .select()
      .from(S().userModels)
      .where(and(eq(S().userModels.userId, user.id), eq(S().userModels.enabled, true))),
  ]);
  return {
    globals: globals as Record<string, unknown>[],
    byos: byos as Record<string, unknown>[],
  };
}

// ===================== BYO Routes(个人模型多路由)=====================

/** 列出我的路由(可按模型过滤),join provider 取展示名。 */
export async function listMyRoutes(modelId?: string) {
  const user = await requireSession();
  const db = await getDb();
  const conds = [eq(S().userRoutes.userId, user.id)];
  if (modelId) conds.push(eq(S().userRoutes.userModelId, modelId));
  return db
    .select({ route: S().userRoutes, providerName: S().userProviders.name })
    .from(S().userRoutes)
    .innerJoin(S().userProviders, eq(S().userRoutes.providerId, S().userProviders.id))
    .where(and(...conds));
}

/**
 * 创建 BYO 路由。先校验 modelId 归属当前用户(防越权挂路由到他人模型),
 * 再校验 providerId 归属当前用户(防越权指向他人 provider 泄密钥)。
 */
export async function createMyRoute(modelId: string, formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const [model] = await db
    .select()
    .from(S().userModels)
    .where(and(eq(S().userModels.id, modelId), eq(S().userModels.userId, user.id)));
  if (!model) throw new Error("模型不存在");
  const providerId = String(formData.get("providerId") ?? "");
  const [provider] = await db
    .select()
    .from(S().userProviders)
    .where(and(eq(S().userProviders.id, providerId), eq(S().userProviders.userId, user.id)));
  if (!provider) throw new Error("服务商不存在");
  await db.insert(S().userRoutes).values({
    userId: user.id,
    userModelId: modelId,
    providerId,
    upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
    priority: Number(formData.get("priority") ?? 0),
    weight: Number(formData.get("weight") ?? 1),
    enabled: true,
  });
  revalidatePath("/panel", "layout");
}

/** 更新 BYO 路由(校验归属)。userModelId 不可改(路由归属模型固定)。 */
export async function updateMyRoute(id: string, formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const providerId = String(formData.get("providerId") ?? "");
  // 校验新 provider 归属当前用户(防越权指向他人 provider)。
  const [provider] = await db
    .select()
    .from(S().userProviders)
    .where(and(eq(S().userProviders.id, providerId), eq(S().userProviders.userId, user.id)));
  if (!provider) throw new Error("服务商不存在");
  await db
    .update(S().userRoutes)
    .set({
      providerId,
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
      priority: Number(formData.get("priority") ?? 0),
      weight: Number(formData.get("weight") ?? 1),
    })
    .where(and(eq(S().userRoutes.id, id), eq(S().userRoutes.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 删除 BYO 路由(校验归属)。 */
export async function deleteMyRoute(id: string) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .delete(S().userRoutes)
    .where(and(eq(S().userRoutes.id, id), eq(S().userRoutes.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 启停 BYO 路由(校验归属)。 */
export async function toggleMyRoute(id: string, enabled: boolean) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .update(S().userRoutes)
    .set({ enabled })
    .where(and(eq(S().userRoutes.id, id), eq(S().userRoutes.userId, user.id)));
  revalidatePath("/panel", "layout");
}

/**
 * 测试单条 BYO 路由的模型可用性:从 user_routes 取 upstreamModelName+providerId →
 * user_providers(校验归属)→ pickWeightedKey → probeProviderKey(传 upstreamModelName,
 * 走"测具体模型"路径发极小生成请求)→ 喂熔断器。与 admin testRoute 同构,仅数据源不同。
 */
export async function testMyRoute(routeId: string): Promise<ProbeResult> {
  const user = await requireSession();
  const db = await getDb();
  const [route] = await db
    .select()
    .from(S().userRoutes)
    .where(and(eq(S().userRoutes.id, routeId), eq(S().userRoutes.userId, user.id)));
  if (!route) throw new Error("路由不存在");
  const [provider] = await db
    .select()
    .from(S().userProviders)
    .where(
      and(eq(S().userProviders.id, route.providerId), eq(S().userProviders.userId, user.id)),
    );
  if (!provider) throw new Error("服务商不存在");

  const keys = parseKeyBundle(provider.apiKeyEnc as string);
  const apiKey = pickWeightedKey(keys);
  const providerId = provider.id as string;
  const result = await probeProviderKey({
    protocol: provider.protocol as ProviderProtocol,
    baseUrl: provider.baseUrl,
    apiKey,
    upstreamModelName: route.upstreamModelName as string,
  });
  if (result.ok) recordSuccess(providerId);
  else recordFailure(providerId);
  return result;
}
