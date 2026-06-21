"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { encryptKeyBundle } from "@/lib/providers/keys";
import type { WeightedKey } from "@/lib/providers/keys";
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

// ===================== Models =====================

export async function listModels() {
  await requireAdmin();
  const db = await getDb();
  return db.select().from(S().globalModels).orderBy(S().globalModels.sortOrder);
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
  await db.insert(S().globalModels).values({
    name: String(formData.get("name") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    vendor: String(formData.get("vendor") ?? ""),
    capabilities,
    accessScope: String(formData.get("accessScope") ?? "public"),
    enabled: true,
    systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
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
    protocol: String(fd.get("protocol") ?? "openai"),
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

/** 更新路由。modelId 不可改(路由归属模型固定)。 */
export async function updateRoute(id: string, formData: FormData) {
  await requireAdmin();
  const db = await getDb();
  await db
    .update(S().globalRoutes)
    .set({
      providerId: String(formData.get("providerId") ?? ""),
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
      protocol: String(formData.get("protocol") ?? "openai"),
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
