"use server";
import { eq, ne, and, or, asc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { encryptKeyBundle, parseKeyBundle } from "@/lib/providers/keys";
import type { WeightedKey } from "@/lib/providers/keys";
import { probeProviderKey, fetchUpstreamModels, type ProbeResult, type UpstreamModel } from "@/lib/providers/probe";
import { normalizeBaseUrl } from "@/lib/providers/defaults";
import { recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import { pickWeightedKey } from "@/lib/providers/keys";
import type { ProviderProtocol } from "@/db/types";
import { requireAdmin } from "@/lib/session";
import { pickDisplayName } from "@/lib/model-catalog";

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

/**
 * 解析 FormData 中的可见性字段。
 * 兼容旧 UI 的 accessScope(public/internal → public);阶段4 UI 改为 visibility 选择器。
 * 普通用户不应调用此函数(panel 侧强制 private)。
 */
function resolveVisibility(formData: FormData, fallback = "private"): "public" | "private" {
  const raw = String(formData.get("visibility") ?? formData.get("accessScope") ?? fallback);
  return raw === "public" || raw === "internal" ? "public" : "private";
}

/** 校验当前 admin 对模型的管理权:public 任意 admin 可改;private 仅 owner。 */
async function assertModelManageable(db: unknown, id: string, adminId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [existing] = await (db as any)
    .select({ ownerUserId: S().models.ownerUserId, visibility: S().models.visibility })
    .from(S().models)
    .where(eq(S().models.id, id))
    .limit(1);
  if (!existing) throw new Error("模型不存在");
  if (existing.visibility !== "public" && existing.ownerUserId !== adminId) throw new Error("无权操作");
  return existing as { ownerUserId: string; visibility: string };
}

/** 校验当前 admin 对路由的管理权(经模型 visibility 判定)。 */
async function assertRouteManageable(db: unknown, routeId: string, adminId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [route] = await (db as any)
    .select({ ownerUserId: S().routes.ownerUserId, modelId: S().routes.modelId })
    .from(S().routes)
    .where(eq(S().routes.id, routeId))
    .limit(1);
  if (!route) throw new Error("路由不存在");
  if (route.ownerUserId === adminId) return;
  // 非 owner → 仅当模型为 public 时允许
  await assertModelManageable(db, route.modelId, adminId);
}

// ===================== Providers =====================

export async function listProviders() {
  const admin = await requireAdmin();
  const db = await getDb();
  // providers 无 visibility,恒 per-user:仅 owner 自己可见。
  return db
    .select()
    .from(S().providers)
    .where(eq(S().providers.ownerUserId, admin.id))
    .orderBy(S().providers.createdAt);
}

export async function createProvider(formData: FormData) {
  const admin = await requireAdmin();
  const db = await getDb();
  const keys = collectKeys(formData);
  if (keys.length === 0) throw new Error("至少需要一个 API Key");
  const apiKeysEnc = encryptKeyBundle(keys);
  await db.insert(S().providers).values({
    ownerUserId: admin.id,
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: normalizeBaseUrl(
      String(formData.get("protocol") ?? "openai") as ProviderProtocol,
      String(formData.get("baseUrl") ?? ""),
    ),
    apiKeysEnc,
    keyStrategy: String(formData.get("keyStrategy") ?? "round_robin"),
    enabled: true,
    priority: 0,
  });
  revalidatePath("/admin", "layout");
}

/** 更新 provider(支持改 name/baseUrl/protocol/keys)。keys 为空表示不改 key。 */
export async function updateProvider(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const db = await getDb();
  const patch: Record<string, unknown> = {
    name: String(formData.get("name") ?? ""),
    protocol: String(formData.get("protocol") ?? "openai"),
    baseUrl: normalizeBaseUrl(
      String(formData.get("protocol") ?? "openai") as ProviderProtocol,
      String(formData.get("baseUrl") ?? ""),
    ),
    updatedAt: new Date(),
  };
  const keys = collectKeys(formData);
  if (keys.length > 0) {
    patch.apiKeysEnc = encryptKeyBundle(keys);
  }
  const ks = formData.get("keyStrategy");
  if (ks !== null) patch.keyStrategy = String(ks);
  await db
    .update(S().providers)
    .set(patch)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  revalidatePath("/admin", "layout");
}

export async function toggleProvider(id: string, enabled: boolean) {
  const admin = await requireAdmin();
  const db = await getDb();
  await db
    .update(S().providers)
    .set({ enabled })
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  revalidatePath("/admin", "layout");
}

export async function deleteProvider(id: string) {
  const admin = await requireAdmin();
  const db = await getDb();
  await db
    .delete(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
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
 * 检测 provider 的所有 key 健康度,汇总成 X/Y 并落库。
 * 串行逐个探测(避免并发冲击上游),结果写回 provider 表,列表持久展示。
 */
export async function checkProviderHealth(id: string): Promise<ProviderHealthResult> {
  const admin = await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
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
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  revalidatePath("/admin", "layout");
  return { healthy, total: keys.length, checkedAt };
}

/** 拉取 provider 的上游模型列表(直接 fetch /models)。 */
export async function listUpstreamModels(id: string): Promise<UpstreamModel[]> {
  const admin = await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
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
    .from(S().routes)
    .where(eq(S().routes.id, routeId));
  if (!route) throw new Error("路由不存在");
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(eq(S().providers.id, route.providerId));
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

/** 显示名留空时回退:匹配到的目录名(catalogId 命中时)→ 对外模型名。admin 侧 catalogId 为表单原值。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveDisplayName(db: any, rawDisplayName: string, catalogId: string, fallbackName: string): Promise<string> {
  let catalogName: string | undefined;
  if (catalogId) {
    const [catalog] = await db
      .select({ name: S().modelCatalog.name })
      .from(S().modelCatalog)
      .where(eq(S().modelCatalog.id, catalogId))
      .limit(1);
    catalogName = catalog?.name as string | undefined;
  }
  return pickDisplayName(rawDisplayName, catalogName, fallbackName);
}

export async function listModels() {
  const admin = await requireAdmin();
  const db = await getDb();
  // admin 可见:public ∪ (private && owner=自己)。
  const rows = await db
    .select({ model: S().models, catalog: S().modelCatalog })
    .from(S().models)
    .innerJoin(S().modelCatalog, eq(S().models.catalogId, S().modelCatalog.id))
    .where(or(eq(S().models.visibility, "public"), eq(S().models.ownerUserId, admin.id)))
    .orderBy(asc(S().models.sortOrder), asc(S().models.createdAt));
  return rows.map((row: Record<string, unknown>) => {
    const model = row.model as Record<string, unknown>;
    const catalog = row.catalog as Record<string, unknown>;
    return { ...model, catalog, capabilities: catalog.capabilities };
  });
}

export async function listRoutes() {
  const admin = await requireAdmin();
  const db = await getDb();
  // 路由可见性跟随模型:public 模型的路由 ∪ 自己 owner 的路由。
  return db
    .select({
      route: S().routes,
      providerName: S().providers.name,
    })
    .from(S().routes)
    .innerJoin(S().providers, eq(S().routes.providerId, S().providers.id))
    .innerJoin(S().models, eq(S().routes.modelId, S().models.id))
    .where(or(eq(S().models.visibility, "public"), eq(S().routes.ownerUserId, admin.id)));
}

export async function createModel(formData: FormData) {
  const admin = await requireAdmin();
  const db = await getDb();
  const name = String(formData.get("name") ?? "");
  const visibility = resolveVisibility(formData);
  const catalogId = String(formData.get("catalogId") ?? "");
  const displayName = await resolveDisplayName(db, String(formData.get("displayName") ?? ""), catalogId, name);
  // public 模型 name 全局唯一(应用层校验,避免多 admin 建同名 public)。
  if (visibility === "public") {
    const [dup] = await db
      .select({ id: S().models.id })
      .from(S().models)
      .where(and(eq(S().models.visibility, "public"), eq(S().models.name, name)))
      .limit(1);
    if (dup) throw new Error("已存在同名 public 模型");
  }
  // 新建模型默认放末尾(per-owner:只查当前 admin 的 max(sortOrder),空表时从 0 起)。
  const [maxRow] = await db
    .select({ maxSort: sql<number>`coalesce(max(${S().models.sortOrder}), -1)` })
    .from(S().models)
    .where(eq(S().models.ownerUserId, admin.id));
  const nextSort = (maxRow?.maxSort ?? -1) + 1;
  await db.insert(S().models).values({
    ownerUserId: admin.id,
    visibility,
    name,
    displayName,
    catalogId,
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
  const admin = await requireAdmin();
  const db = await getDb();
  const fd = typeof modelIdOrFormData === "string" ? formData! : modelIdOrFormData;
  const modelId =
    typeof modelIdOrFormData === "string" ? modelIdOrFormData : String(fd.get("modelId") ?? "");
  // 路由归属模型:校验模型存在且 admin 有管理权(public 或自己的)。
  const model = await assertModelManageable(db, modelId, admin.id);
  await db.insert(S().routes).values({
    ownerUserId: model.ownerUserId, // 跟随所属 model owner
    modelId,
    providerId: String(fd.get("providerId") ?? ""),
    upstreamModelName: String(fd.get("upstreamModelName") ?? ""),
    priority: Number(fd.get("priority") ?? 0),
    weight: Number(fd.get("weight") ?? 1),
    enabled: true,
  });
  revalidatePath("/admin", "layout");
}

/** 更新模型。能力由所选模型模板实时提供。 */
export async function updateModel(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const db = await getDb();
  const existing = await assertModelManageable(db, id, admin.id);
  const name = String(formData.get("name") ?? "");
  const catalogId = String(formData.get("catalogId") ?? "");
  const displayName = await resolveDisplayName(db, String(formData.get("displayName") ?? ""), catalogId, name);
  const patch: Record<string, unknown> = {
    name,
    displayName,
    catalogId,
    systemPrompt: String(formData.get("systemPrompt") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
    updatedAt: new Date(),
  };
  // visibility 仅在显式提供时更新(发布开关,阶段4 UI)
  const visRaw = String(formData.get("visibility") ?? formData.get("accessScope") ?? "");
  if (visRaw) patch.visibility = resolveVisibility(formData);
  // public 模型 name 全局唯一:发布(public)或改名时校验,避免多 admin 同名 public 冲突。
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
    .where(eq(S().models.id, id));
  revalidatePath("/admin", "layout");
}

export async function deleteModel(id: string) {
  const admin = await requireAdmin();
  const db = await getDb();
  await assertModelManageable(db, id, admin.id);
  // routes 对 models 有 onDelete: cascade,路由会自动级联删除。
  await db.delete(S().models).where(eq(S().models.id, id));
  revalidatePath("/admin", "layout");
}

/**
 * 拖动重排:按拖动后的完整顺序重写当前 admin 的 sortOrder 为连续整数 0,1,2…
 * 安全关键:每条 update 必须带 ownerUserId 条件(per-owner 隔离),防止改到他人模型顺序。
 * 单事务包裹,中途失败整体回滚。id 不存在或不属于该 admin 自然跳过(update 0 行)。
 */
export async function reorderModels(orderedIds: string[]) {
  const admin = await requireAdmin();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(S().models)
        .set({ sortOrder: i })
        .where(
          and(eq(S().models.id, orderedIds[i]), eq(S().models.ownerUserId, admin.id)),
        );
    }
  });
  revalidatePath("/admin", "layout");
}

/** 更新路由。modelId 不可改(路由归属模型固定)。 */
export async function updateRoute(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const db = await getDb();
  await assertRouteManageable(db, id, admin.id);
  await db
    .update(S().routes)
    .set({
      providerId: String(formData.get("providerId") ?? ""),
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
      priority: Number(formData.get("priority") ?? 0),
      weight: Number(formData.get("weight") ?? 1),
    })
    .where(eq(S().routes.id, id));
  revalidatePath("/admin", "layout");
}

export async function deleteRoute(id: string) {
  const admin = await requireAdmin();
  const db = await getDb();
  await assertRouteManageable(db, id, admin.id);
  await db.delete(S().routes).where(eq(S().routes.id, id));
  revalidatePath("/admin", "layout");
}

export async function toggleRoute(id: string, enabled: boolean) {
  const admin = await requireAdmin();
  const db = await getDb();
  await assertRouteManageable(db, id, admin.id);
  await db.update(S().routes).set({ enabled }).where(eq(S().routes.id, id));
  revalidatePath("/admin", "layout");
}

export async function toggleModel(id: string, enabled: boolean) {
  const admin = await requireAdmin();
  const db = await getDb();
  await assertModelManageable(db, id, admin.id);
  await db.update(S().models).set({ enabled }).where(eq(S().models.id, id));
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
