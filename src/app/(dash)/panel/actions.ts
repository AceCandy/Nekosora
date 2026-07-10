"use server";
import { eq, ne, and, asc, sql } from "drizzle-orm";
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

export async function bindModel(keyId: string, modelId: string) {
  await requireSession();
  const db = await getDb();
  // 收敛后绑定只存 modelId(原 scope+globalModelId+userModelId 已废弃)。
  await db.insert(S().keyModelBindings).values({
    keyId,
    modelId,
  });
  revalidatePath("/panel", "layout");
}

export async function unbindBinding(bindingId: string) {
  await requireSession();
  const db = await getDb();
  await db.delete(S().keyModelBindings).where(eq(S().keyModelBindings.id, bindingId));
  revalidatePath("/panel", "layout");
}

// ===================== Providers =====================

export async function getMyProviders() {
  const user = await requireSession();
  const db = await getDb();
  // providers 无 visibility,恒 per-user:仅 owner 自己可见。
  return db
    .select()
    .from(S().providers)
    .where(eq(S().providers.ownerUserId, user.id));
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
  await db.insert(S().providers).values({
    ownerUserId: user.id,
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKeysEnc: encryptKeyBundle(keys),
    keyStrategy: String(formData.get("keyStrategy") ?? "round_robin"),
    enabled: true,
  });
  revalidatePath("/panel", "layout");
}

/** 删除 provider。 */
export async function deleteMyProvider(id: string) {
  const user = await requireSession();
  const db = await getDb();
  // 校验归属:只能删自己的。
  await db
    .delete(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 启用/禁用 provider。 */
export async function toggleMyProvider(id: string, enabled: boolean) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .update(S().providers)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, user.id)));
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
 * 检测 provider 的所有 key 健康度(校验归属),汇总 X/Y 并落库。
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
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, user.id)));
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
    .update(S().providers)
    .set({
      lastHealthCheckedAt: new Date(checkedAt),
      lastHealthyKeyCount: healthy,
      lastTotalKeyCount: keys.length,
      updatedAt: new Date(),
    })
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
  return { healthy, total: keys.length, checkedAt };
}

/** 拉取 provider 的上游模型列表(校验归属,仅限自己的)。 */
export async function listMyUpstreamModels(id: string): Promise<UpstreamModel[]> {
  const user = await requireSession();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, user.id)));
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
 * 更新 provider(name/baseUrl/protocol/keys)。
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
    patch.apiKeysEnc = encryptKeyBundle(keys);
  }
  const ks = formData.get("keyStrategy");
  if (ks !== null) patch.keyStrategy = String(ks);
  await db
    .update(S().providers)
    .set(patch)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

// ===================== Models =====================

/**
 * 列出我的模型,每个模型附带其路由链(供前端组装 routeItems)。
 */
export async function getMyModels() {
  const user = await requireSession();
  const db = await getDb();
  const [models, routes] = await Promise.all([
    db
      .select()
      .from(S().models)
      .where(eq(S().models.ownerUserId, user.id))
      .orderBy(asc(S().models.sortOrder), asc(S().models.createdAt)),
    db
      .select({ route: S().routes, providerName: S().providers.name })
      .from(S().routes)
      .innerJoin(S().providers, eq(S().routes.providerId, S().providers.id))
      .where(eq(S().routes.ownerUserId, user.id)),
  ]);
  // 按 modelId 聚合路由。
  const routesByModel = new Map<string, unknown[]>();
  for (const r of routes) {
    const key = (r.route as Record<string, unknown>).modelId as string;
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
  // 普通用户强制 private;admin 可选 public(发布到全局)。
  const visibility: "public" | "private" =
    user.role === "admin"
      ? String(formData.get("visibility") ?? formData.get("accessScope") ?? "private") === "public"
        ? "public"
        : "private"
      : "private";
  // 新建模型默认放末尾(per-owner:只查当前用户的 max(sortOrder),空表时从 0 起)。
  const [maxRow] = await db
    .select({ maxSort: sql<number>`coalesce(max(${S().models.sortOrder}), -1)` })
    .from(S().models)
    .where(eq(S().models.ownerUserId, user.id));
  const nextSort = (maxRow?.maxSort ?? -1) + 1;
  await db.insert(S().models).values({
    ownerUserId: user.id,
    visibility,
    name: String(formData.get("name") ?? ""),
    displayName: String(formData.get("displayName") ?? "") || null,
    vendor: String(formData.get("vendor") ?? "") || null,
    systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
    capabilities,
    enabled: true,
    sortOrder: nextSort,
  });
  revalidatePath("/panel", "layout");
}

/**
 * 拖动重排:按拖动后的完整顺序重写当前用户的 sortOrder 为连续整数 0,1,2…
 * 安全关键:每条 update 必须带 ownerUserId 条件,防止用户改到他人模型顺序。
 * 单事务包裹,中途失败整体回滚。id 不存在或不属于该用户自然跳过(update 0 行)。
 */
export async function reorderMyModels(orderedIds: string[]) {
  const user = await requireSession();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(S().models)
        .set({ sortOrder: i })
        .where(
          and(eq(S().models.id, orderedIds[i]), eq(S().models.ownerUserId, user.id)),
        );
    }
  });
  revalidatePath("/panel", "layout");
}

/** 更新模型(校验归属)。provider/upstreamModelName 改由路由管理。 */
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
  const patch: Record<string, unknown> = {
    name: String(formData.get("name") ?? ""),
    displayName: String(formData.get("displayName") ?? "") || null,
    vendor: String(formData.get("vendor") ?? "") || null,
    systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
    capabilities,
    updatedAt: new Date(),
  };
  // 仅 admin 可改 visibility(发布/取消发布);普通用户忽略。
  if (user.role === "admin") {
    const visRaw = String(formData.get("visibility") ?? formData.get("accessScope") ?? "");
    if (visRaw) {
      patch.visibility = visRaw === "public" || visRaw === "internal" ? "public" : "private";
    }
  }
  // public 模型 name 全局唯一:发布(public)或改名时校验,避免多 admin 同名 public 冲突。
  const [existing] = await db
    .select({ visibility: S().models.visibility })
    .from(S().models)
    .where(and(eq(S().models.id, id), eq(S().models.ownerUserId, user.id)))
    .limit(1);
  if (!existing) throw new Error("模型不存在或无权操作");
  const finalVisibility = (patch.visibility as string | undefined) ?? existing.visibility;
  if (finalVisibility === "public") {
    const [dup] = await db
      .select({ id: S().models.id })
      .from(S().models)
      .where(
        and(
          eq(S().models.visibility, "public"),
          eq(S().models.name, patch.name as string),
          ne(S().models.id, id),
        ),
      )
      .limit(1);
    if (dup) throw new Error("已存在同名 public 模型");
  }
  await db
    .update(S().models)
    .set(patch)
    .where(and(eq(S().models.id, id), eq(S().models.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 删除模型(校验归属)。 */
export async function deleteMyModel(id: string) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .delete(S().models)
    .where(and(eq(S().models.id, id), eq(S().models.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 启停模型。 */
export async function toggleMyModel(id: string, enabled: boolean) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .update(S().models)
    .set({ enabled })
    .where(and(eq(S().models.id, id), eq(S().models.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 可供子 key 绑定的模型列表:public ∪ 我的(byo)。 */
export async function getBindableModels() {
  const user = await requireSession();
  const db = await getDb();
  const [globals, byos] = await Promise.all([
    db
      .select()
      .from(S().models)
      .where(and(eq(S().models.visibility, "public"), eq(S().models.enabled, true))),
    db
      .select()
      .from(S().models)
      .where(
        and(
          eq(S().models.ownerUserId, user.id),
          eq(S().models.visibility, "private"),
          eq(S().models.enabled, true),
        ),
      ),
  ]);
  return {
    globals: globals as Record<string, unknown>[],
    byos: byos as Record<string, unknown>[],
  };
}

// ===================== Routes(个人模型多路由)=====================

/** 列出我的路由(可按模型过滤),join provider 取展示名。 */
export async function listMyRoutes(modelId?: string) {
  const user = await requireSession();
  const db = await getDb();
  const conds = [eq(S().routes.ownerUserId, user.id)];
  if (modelId) conds.push(eq(S().routes.modelId, modelId));
  return db
    .select({ route: S().routes, providerName: S().providers.name })
    .from(S().routes)
    .innerJoin(S().providers, eq(S().routes.providerId, S().providers.id))
    .where(and(...conds));
}

/**
 * 创建路由。先校验 modelId 归属当前用户(防越权挂路由到他人模型),
 * 再校验 providerId 归属当前用户(防越权指向他人 provider 泄密钥)。
 */
export async function createMyRoute(modelId: string, formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const [model] = await db
    .select()
    .from(S().models)
    .where(and(eq(S().models.id, modelId), eq(S().models.ownerUserId, user.id)));
  if (!model) throw new Error("模型不存在");
  const providerId = String(formData.get("providerId") ?? "");
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, providerId), eq(S().providers.ownerUserId, user.id)));
  if (!provider) throw new Error("服务商不存在");
  await db.insert(S().routes).values({
    ownerUserId: user.id,
    modelId,
    providerId,
    upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
    priority: Number(formData.get("priority") ?? 0),
    weight: Number(formData.get("weight") ?? 1),
    enabled: true,
  });
  revalidatePath("/panel", "layout");
}

/** 更新路由(校验归属)。modelId 不可改(路由归属模型固定)。 */
export async function updateMyRoute(id: string, formData: FormData) {
  const user = await requireSession();
  const db = await getDb();
  const providerId = String(formData.get("providerId") ?? "");
  // 校验新 provider 归属当前用户(防越权指向他人 provider)。
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, providerId), eq(S().providers.ownerUserId, user.id)));
  if (!provider) throw new Error("服务商不存在");
  await db
    .update(S().routes)
    .set({
      providerId,
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
      priority: Number(formData.get("priority") ?? 0),
      weight: Number(formData.get("weight") ?? 1),
    })
    .where(and(eq(S().routes.id, id), eq(S().routes.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 删除路由(校验归属)。 */
export async function deleteMyRoute(id: string) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .delete(S().routes)
    .where(and(eq(S().routes.id, id), eq(S().routes.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/** 启停路由(校验归属)。 */
export async function toggleMyRoute(id: string, enabled: boolean) {
  const user = await requireSession();
  const db = await getDb();
  await db
    .update(S().routes)
    .set({ enabled })
    .where(and(eq(S().routes.id, id), eq(S().routes.ownerUserId, user.id)));
  revalidatePath("/panel", "layout");
}

/**
 * 测试单条路由的模型可用性:从 routes 取 upstreamModelName+providerId →
 * providers(校验归属)→ pickWeightedKey → probeProviderKey(传 upstreamModelName,
 * 走"测具体模型"路径发极小生成请求)→ 喂熔断器。与 admin testRoute 同构。
 */
export async function testMyRoute(routeId: string): Promise<ProbeResult> {
  const user = await requireSession();
  const db = await getDb();
  const [route] = await db
    .select()
    .from(S().routes)
    .where(and(eq(S().routes.id, routeId), eq(S().routes.ownerUserId, user.id)));
  if (!route) throw new Error("路由不存在");
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(
      and(eq(S().providers.id, route.providerId), eq(S().providers.ownerUserId, user.id)),
    );
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
  if (result.ok) recordSuccess(providerId);
  else recordFailure(providerId);
  return result;
}
