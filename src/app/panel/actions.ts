"use server";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { encryptKeyBundle } from "@/lib/providers/keys";
import type { WeightedKey } from "@/lib/providers/keys";
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

export async function getMyModels() {
  const user = await requireSession();
  const db = await getDb();
  return db
    .select({
      model: S().userModels,
      providerName: S().userProviders.name,
    })
    .from(S().userModels)
    .innerJoin(S().userProviders, eq(S().userModels.providerId, S().userProviders.id))
    .where(eq(S().userModels.userId, user.id));
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
    providerId: String(formData.get("providerId") ?? ""),
    name: String(formData.get("name") ?? ""),
    upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
    capabilities,
    enabled: true,
  });
  revalidatePath("/panel", "layout");
}

/** 更新 BYO 模型(校验归属)。 */
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
      providerId: String(formData.get("providerId") ?? ""),
      name: String(formData.get("name") ?? ""),
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
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
