"use server";
import { eq, ne, and, or, asc, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuth } from "@/auth";
import { getDb, getSchema } from "@/lib/infra/db";
import { encryptKeyBundle, parseKeyBundle } from "@/lib/providers/keys";
import type { WeightedKey } from "@/lib/providers/keys";
import { probeProviderKey, fetchUpstreamModels, type ProbeResult, type UpstreamModel } from "@/lib/providers/probe";
import { getProbeHeaders } from "@/lib/system-settings/ua";
import { normalizeBaseUrl } from "@/lib/providers/defaults";
import {
  parseProviderTimeoutFormData,
  pickProviderTimeoutConfig,
  type ProviderTimeoutConfig,
} from "@/lib/providers/timeouts";
import { requireOwnedProvider } from "@/lib/providers/ownership";
import {
  resolveCatalogRouteApiFormat,
  resolveModelRouteApiFormat,
} from "@/lib/providers/route-api-format";
import { recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import { pickWeightedKey } from "@/lib/providers/keys";
import type { ProviderProtocol, RouteApiFormat } from "@/db/types";
import type { ProviderKeyResult } from "@/db/schema/pg";
import { requireAdmin } from "@/lib/session";
import { pickDisplayName } from "@/lib/model-catalog";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/**
 * 从 FormData 收集多 key、权重与备注。
 * 约定字段名:`keys[].key` / `keys[].weight` / `keys[].note`(也兼容旧单 key 表单)。
 * 过滤空 key;weight 缺省/非法 → 1。
 */
function collectKeys(formData: FormData): WeightedKey[] {
  const keys = formData.getAll("keys[].key").map((k) => String(k));
  const weights = formData.getAll("keys[].weight").map((w) => Number(String(w)));
  const notes = formData.getAll("keys[].note").map((note) => String(note).trim());
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
      ...(notes[i] && { note: notes[i] }),
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
    .select({
      ownerUserId: S().routes.ownerUserId,
      modelId: S().routes.modelId,
      providerId: S().routes.providerId,
      upstreamModelName: S().routes.upstreamModelName,
      apiFormat: S().routes.apiFormat,
    })
    .from(S().routes)
    .where(eq(S().routes.id, routeId))
    .limit(1);
  if (!route) throw new Error("路由不存在");
  if (route.ownerUserId !== adminId) {
    // 非 owner → 仅当模型为 public 时允许
    await assertModelManageable(db, route.modelId, adminId);
  }
  return route as {
    ownerUserId: string;
    modelId: string;
    providerId: string;
    upstreamModelName: string;
    apiFormat: RouteApiFormat;
  };
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

/**
 * 拉取上游模型列表并落库到 provider(upstreamModels + upstreamModelsAt)。
 * 拉取失败抛错,由调用方决定是否静默;调用方需先完成归属校验。
 */
async function fetchAndStoreUpstreamModels(
  db: Awaited<ReturnType<typeof getDb>>,
  providerId: string,
  protocol: ProviderProtocol,
  baseUrl: string,
  apiKey: string,
  timeouts: ProviderTimeoutConfig,
): Promise<{ models: string[]; checkedAt: number }> {
  const fetched = await fetchUpstreamModels({ protocol, baseUrl, apiKey, ...timeouts });
  const models = fetched.map((m) => m.id);
  const checkedAt = Date.now();
  await db
    .update(S().providers)
    .set({ upstreamModels: models, upstreamModelsAt: new Date(checkedAt), updatedAt: new Date() })
    .where(eq(S().providers.id, providerId));
  return { models, checkedAt };
}

export async function createProvider(formData: FormData) {
  const admin = await requireAdmin();
  const db = await getDb();
  const keys = collectKeys(formData);
  // 允许无 key provider(如 OVH 免费层):keys 为空时存空 bundle,转发时用空 key。
  const apiKeysEnc = encryptKeyBundle(keys);
  const protocol = String(formData.get("protocol") ?? "openai") as ProviderProtocol;
  const baseUrl = normalizeBaseUrl(protocol, String(formData.get("baseUrl") ?? ""));
  const timeouts = parseProviderTimeoutFormData(formData);
  const [created] = await db
    .insert(S().providers)
    .values({
      ownerUserId: admin.id,
      name: String(formData.get("name") ?? ""),
      protocol,
      baseUrl,
      apiKeysEnc,
      testModel: String(formData.get("testModel") ?? ""),
      ...timeouts,
      keyStrategy: "weighted",
      enabled: true,
      priority: 0,
    })
    .returning({ id: S().providers.id });
  revalidatePath("/admin", "layout");

  // 创建后自动拉取一次上游模型列表并落库;失败静默不阻塞创建(无 key 用空 key,与转发一致)。
  await fetchAndStoreUpstreamModels(
    db,
    created.id,
    protocol,
    baseUrl,
    keys[0]?.key ?? "",
    timeouts,
  ).catch(() => {});
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
    testModel: String(formData.get("testModel") ?? ""),
    supportsStreamUsage: null,
    updatedAt: new Date(),
  };
  const keys = collectKeys(formData);
  if (formData.get("providerTimeoutsPresent") === "1") {
    Object.assign(patch, parseProviderTimeoutFormData(formData));
  }
  const noKey = formData.get("noKey") === "1";
  // 无 key 模式:显式清空 bundle;否则 keys 非空才更新,空表示不改 key。
  if (noKey) {
    patch.apiKeysEnc = encryptKeyBundle([]);
  } else if (keys.length > 0) {
    patch.apiKeysEnc = encryptKeyBundle(keys);
  }
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
 * 有 testModel 时走深度检测(带 model 极小生成验全链路),无则空 body 验 key。
 */
export async function testKeyDirect(input: {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  /** 检测模型:传入则走深度检测,缺省空 body 验 key。 */
  testModel?: string;
}): Promise<ProbeResult> {
  await requireAdmin();
  return probeProviderKey({
    protocol: input.protocol as ProviderProtocol,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    upstreamModelName: input.testModel || undefined,
    headers: await getProbeHeaders(),
  });
}

/** provider 全量密钥存活检测结果(检测所有 key 后返回,UI 展示 X/Y + 网络层 + per-key)。 */
export interface ProviderHealthResult {
  healthy: number;
  total: number;
  checkedAt: number;
  /** 网络层连通:任一 key 探测非 network 即通(能连上服务器)。 */
  networkOk: boolean;
  /** 逐 key 探测结果(用 index 标识,不存明文 key)。 */
  keyResults: ProviderKeyResult[];
}

/**
 * 检测 provider 的所有 key 存活:网络层(任一非 network 即通) + key 层(每 key 401/403 判无效)。
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
  // 无 key provider(如 OVH 免费层):keys 为空时用空 key 探测一次上游连通性,
  // 与转发时空 key 行为一致(probe 空 key 不发 Authorization 头)。
  const probeList = keys.length > 0 ? keys : [{ key: "", weight: 1 }];
  const protocol = provider.protocol as ProviderProtocol;
  const baseUrl = provider.baseUrl as string;
  const testModel = (provider.testModel as string | null) ?? "";
  const keyResults: ProviderKeyResult[] = [];
  // 检测请求 UA(与聊天 UA 一致);循环外读一次,两条探测路径共用。
  const probeHeaders = await getProbeHeaders();
  const timeoutOptions = pickProviderTimeoutConfig(provider);
  // 存活检测回退深度检测时,聚合 provider 级深度结果(任一 key 深度成功即 true)。null=未回退。
  let modelProbeOk: boolean | null = null;
  let modelProbeError: string | null = null;
  for (let i = 0; i < probeList.length; i++) {
    let result = await probeProviderKey({
      protocol,
      baseUrl,
      apiKey: probeList[i].key,
      headers: probeHeaders,
      ...timeoutOptions,
    });
    // 存活检测失败(非网络)+配了 testModel -> 回退深度检测(带 model 极小生成)。
    // opencode 等先验 model 的上游空 body 验不了 key,靠深度检测确认;成功则该 key 标通过。
    if (!result.ok && result.errorKind !== "network" && testModel) {
      const deep = await probeProviderKey({
        protocol,
        baseUrl,
        apiKey: probeList[i].key,
        upstreamModelName: testModel,
        headers: probeHeaders,
        ...timeoutOptions,
      });
      result = deep.ok
        ? { ok: true, latencyMs: deep.latencyMs, mode: deep.mode }
        : { ok: false, latencyMs: deep.latencyMs, error: deep.error, errorKind: deep.errorKind };
      if (modelProbeOk !== true) {
        modelProbeOk = deep.ok;
        modelProbeError = deep.ok ? null : (deep.error ?? null);
      }
    }
    keyResults.push({
      index: i,
      ok: result.ok,
      errorKind: result.errorKind,
      error: result.error,
    });
  }
  const healthy = keyResults.filter((r) => r.ok).length;
  // 网络层:任一 key 探测非 network 即通(含 ok/auth/unknown,均说明能连上服务器)。
  const networkOk = keyResults.some((r) => r.errorKind !== "network");
  const checkedAt = Date.now();
  const updateSet: Record<string, unknown> = {
    lastHealthCheckedAt: new Date(checkedAt),
    lastHealthyKeyCount: healthy,
    lastTotalKeyCount: probeList.length,
    lastNetworkOk: networkOk,
    lastKeyResults: keyResults,
    updatedAt: new Date(),
  };
  // 回退过深度检测才更新深度结果(未回退保留旧值)。
  if (modelProbeOk !== null) {
    updateSet.lastModelProbeOk = modelProbeOk;
    updateSet.lastModelProbeAt = new Date();
    updateSet.lastModelProbeError = modelProbeError;
  }
  await db
    .update(S().providers)
    .set(updateSet)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  revalidatePath("/admin", "layout");
  return { healthy, total: probeList.length, checkedAt, networkOk, keyResults };
}

/**
 * 深度检测 provider 的 testModel:用 testModel 发极小生成请求,验证 model+key+协议全链路。
 * 用于 opencode 等先校验 model 的上游(空 body 验不了 key),也确认 provider 真能跑该模型。
 * 结果写回 provider 表(lastModelProbeOk/At/Error),列表回显。
 */
export async function testProviderModel(id: string): Promise<ProbeResult> {
  const admin = await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  if (!provider) throw new Error("服务商不存在");

  const testModel = (provider.testModel as string | null) ?? "";
  if (!testModel) {
    return { ok: false, error: "未配置检测模型", errorKind: "unknown" };
  }
  const keys = parseKeyBundle(provider.apiKeysEnc as string);
  const apiKey = pickWeightedKey(keys);
  const result = await probeProviderKey({
    protocol: provider.protocol as ProviderProtocol,
    baseUrl: provider.baseUrl as string,
    apiKey,
    upstreamModelName: testModel,
    headers: await getProbeHeaders(),
    ...pickProviderTimeoutConfig(provider),
  });
  await db
    .update(S().providers)
    .set({
      lastModelProbeOk: result.ok,
      lastModelProbeAt: new Date(),
      lastModelProbeError: result.ok ? null : (result.error ?? null),
      updatedAt: new Date(),
    })
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  revalidatePath("/admin", "layout");
  return result;
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
    ...pickProviderTimeoutConfig(provider),
  });
}

/** 上游模型落库列表的缓存有效期:超期才再次实时拉取,避免每次打开都请求上游。 */
const UPSTREAM_MODELS_TTL_MS = 10 * 60 * 1000;

/**
 * 带缓存的拉取 -- 优先用 provider 已落库的 upstream_models(创建/更新 provider 时自动拉取),
 * 落库为空或超过 TTL 才实时拉取并落库,一段时间内不重复请求上游。
 * 实时拉取失败时,若有过期落库则降级返回,否则抛错由调用方提示。
 */
export async function listUpstreamModelsCached(id: string): Promise<UpstreamModel[]> {
  const admin = await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  if (!provider) throw new Error("服务商不存在");

  const cached = (provider.upstreamModels as string[] | null) ?? null;
  const checkedAt = provider.upstreamModelsAt as Date | null;
  const fresh =
    !!cached &&
    cached.length > 0 &&
    !!checkedAt &&
    Date.now() - checkedAt.getTime() < UPSTREAM_MODELS_TTL_MS;
  if (fresh && cached) {
    return cached.map((mid) => ({ id: mid }));
  }

  // 落库为空或过期:实时拉取并落库。
  const keys = parseKeyBundle(provider.apiKeysEnc as string);
  const firstKey = keys[0]?.key ?? "";
  try {
    const { models } = await fetchAndStoreUpstreamModels(
      db,
      id,
      provider.protocol as ProviderProtocol,
      provider.baseUrl as string,
      firstKey,
      pickProviderTimeoutConfig(provider),
    );
    return models.map((mid) => ({ id: mid }));
  } catch {
    // 拉取失败:有过期落库则降级返回,否则抛错。
    if (cached && cached.length > 0) return cached.map((mid) => ({ id: mid }));
    throw new Error("拉取上游模型失败");
  }
}

/**
 * 拉取 provider 的最新上游模型列表并落库(列表「拉取最新」按钮调用)。
 * 校验归属;拉取失败不落库(保留旧值),抛错供 UI 提示。
 */
export async function refreshUpstreamModels(
  id: string,
): Promise<{ models: string[]; checkedAt: number }> {
  const admin = await requireAdmin();
  const db = await getDb();
  const [provider] = await db
    .select()
    .from(S().providers)
    .where(and(eq(S().providers.id, id), eq(S().providers.ownerUserId, admin.id)));
  if (!provider) throw new Error("服务商不存在");
  const keys = parseKeyBundle(provider.apiKeysEnc as string);
  const result = await fetchAndStoreUpstreamModels(
    db,
    id,
    provider.protocol as ProviderProtocol,
    provider.baseUrl as string,
    keys[0]?.key ?? "",
    pickProviderTimeoutConfig(provider),
  );
  revalidatePath("/admin", "layout");
  return result;
}

/**
 * 测试单条路由的模型可用性(用该 route 的 provider+key+upstreamModelName 发极小请求)。
 * 比单纯验证 key 更进一步:确认"这个 provider 真能跑这个模型"。
 * 结果同步喂养熔断器,让主动测试与被动健康联动。
 */
export async function testRoute(routeId: string): Promise<ProbeResult> {
  const admin = await requireAdmin();
  const db = await getDb();
  const route = await assertRouteManageable(db, routeId, admin.id);
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
    apiFormat: route.apiFormat,
    baseUrl: provider.baseUrl,
    apiKey,
    upstreamModelName: route.upstreamModelName as string,
    headers: await getProbeHeaders(),
    ...pickProviderTimeoutConfig(provider),
  });
  // 喂养熔断器:成功重置,失败累计。
  if (result.ok) recordSuccess(providerId);
  else recordFailure(providerId);
  return result;
}

// ===================== Models =====================

/** 显示名留空时回退:目录名 → 对外模型名;通用模板(__generic_*)跳过目录名直接用对外名。admin 侧 catalogId 为表单原值。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveDisplayName(db: any, rawDisplayName: string, catalogId: string, fallbackName: string): Promise<string> {
  let catalogName: string | undefined;
  let catalogCanonicalId: string | undefined;
  if (catalogId) {
    const [catalog] = await db
      .select({ name: S().modelCatalog.name, canonicalModelId: S().modelCatalog.canonicalModelId })
      .from(S().modelCatalog)
      .where(eq(S().modelCatalog.id, catalogId))
      .limit(1);
    catalogName = catalog?.name as string | undefined;
    catalogCanonicalId = catalog?.canonicalModelId as string | undefined;
  }
  return pickDisplayName(rawDisplayName, catalogName, fallbackName, catalogCanonicalId);
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
      providerEnabled: S().providers.enabled,
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
  const providerId = String(formData.get("providerId") ?? "");
  const upstreamModelName = String(formData.get("upstreamModelName") ?? "");
  const visibility = resolveVisibility(formData);
  const [duplicate] = await db
    .select({ id: S().models.id })
    .from(S().models)
    .where(and(eq(S().models.ownerUserId, admin.id), eq(S().models.name, name)))
    .limit(1);
  if (duplicate) throw new Error(`MODEL_ALREADY_EXISTS: ${visibility === "public" ? "已存在同名 public 模型" : "已存在同名模型"}`);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    let provider: Awaited<ReturnType<typeof requireOwnedProvider>> | undefined;
    if (providerId) {
      provider = await requireOwnedProvider(tx, providerId, admin.id);
    }
    await tx.insert(S().models).values({ ownerUserId: admin.id, visibility, name, displayName, catalogId, enabled: true, systemPrompt: String(formData.get("systemPrompt") ?? "") || null, description: String(formData.get("description") ?? "") || null, sortOrder: nextSort });
    const [created] = await tx.select({ id: S().models.id }).from(S().models).where(and(eq(S().models.ownerUserId, admin.id), eq(S().models.name, name))).limit(1);
    if (provider && upstreamModelName) {
      const apiFormat = await resolveCatalogRouteApiFormat(
        tx,
        catalogId,
        provider.protocol,
        String(formData.get("apiFormat") ?? ""),
      );
      await tx.insert(S().routes).values({ ownerUserId: admin.id, modelId: created.id, providerId, upstreamModelName, apiFormat, enabled: true });
    }
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
  const providerId = String(fd.get("providerId") ?? "");
  // 路由归属模型:校验模型存在且 admin 有管理权(public 或自己的)。
  const model = await assertModelManageable(db, modelId, admin.id);
  const provider = await requireOwnedProvider(db, providerId, admin.id);
  const apiFormat = await resolveModelRouteApiFormat(
    db,
    modelId,
    provider.protocol,
    String(fd.get("apiFormat") ?? ""),
  );
  await db.insert(S().routes).values({
    ownerUserId: model.ownerUserId, // 跟随所属 model owner
    modelId,
    providerId,
    upstreamModelName: String(fd.get("upstreamModelName") ?? ""),
    apiFormat,
    priority: Number(fd.get("priority") ?? 0),
    weight: Number(fd.get("weight") ?? 1),
    supportsTools: !fd.has("supportsToolsPresent") || fd.get("supportsTools") === "on",
    enabled: true,
  });
  revalidatePath("/admin", "layout");
}

/** 从服务商上游模型列表快速补路由；重复绑定返回 exists，不重复写入。 */
export async function attachProviderModelRoute(
  modelId: string,
  providerId: string,
  upstreamModelName: string,
): Promise<{ status: "created" | "exists" }> {
  const admin = await requireAdmin();
  const db = await getDb();
  const model = await assertModelManageable(db, modelId, admin.id);
  const provider = await requireOwnedProvider(db, providerId, admin.id);
  const [existing] = await db
    .select({ id: S().routes.id })
    .from(S().routes)
    .where(and(
      eq(S().routes.modelId, modelId),
      eq(S().routes.providerId, providerId),
      eq(S().routes.upstreamModelName, upstreamModelName),
    ))
    .limit(1);
  if (existing) return { status: "exists" };

  const apiFormat = await resolveModelRouteApiFormat(db, modelId, provider.protocol);
  await db.insert(S().routes).values({
    ownerUserId: model.ownerUserId,
    modelId,
    providerId,
    upstreamModelName,
    apiFormat,
    enabled: true,
  });
  revalidatePath("/admin", "layout");
  return { status: "created" };
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
  const providerId = String(formData.get("providerId") ?? "");
  const route = await assertRouteManageable(db, id, admin.id);
  const provider = await requireOwnedProvider(db, providerId, admin.id);
  const apiFormat = formData.has("apiFormat")
    ? await resolveModelRouteApiFormat(
        db,
        route.modelId,
        provider.protocol,
        String(formData.get("apiFormat") ?? ""),
      )
    : undefined;
  await db
    .update(S().routes)
    .set({
      providerId,
      upstreamModelName: String(formData.get("upstreamModelName") ?? ""),
      ...(apiFormat ? { apiFormat } : {}),
      priority: Number(formData.get("priority") ?? 0),
      weight: Number(formData.get("weight") ?? 1),
      ...(formData.has("supportsToolsPresent") || formData.has("supportsTools")
        ? { supportsTools: formData.get("supportsTools") === "on" }
        : {}),
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

const resetUserPasswordSchema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string(),
});

export type ResetUserPasswordResult =
  | { status: "success"; error: null }
  | {
    status: "error";
    error: "invalidPassword" | "passwordMismatch" | "selfResetForbidden" | "resetFailed" | "sessionRevokeFailed";
  };

export async function listUsers() {
  const admin = await requireAdmin();
  const db = await getDb();
  const users = await db.select().from(S().user).orderBy(S().user.createdAt);
  return users.map((user: Record<string, unknown>) => ({
    ...user,
    isCurrent: user.id === admin.id,
  }));
}

export async function deleteUser(id: string) {
  const admin = await requireAdmin();
  if (id === admin.id) throw new Error("Cannot delete the current account");

  const auth = await getAuth();
  await auth.api.removeUser({ body: { userId: id }, headers: await headers() });
  revalidatePath("/admin/users");
}

/** 管理员为其他用户设置新密码，并在设密成功后撤销其全部现有会话。 */
export async function resetUserPassword(
  id: string,
  formData: FormData,
): Promise<ResetUserPasswordResult> {
  const admin = await requireAdmin();
  const parsed = resetUserPasswordSchema.safeParse({
    userId: id,
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { status: "error", error: "invalidPassword" };
  if (parsed.data.userId === admin.id) return { status: "error", error: "selfResetForbidden" };
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { status: "error", error: "passwordMismatch" };
  }

  const auth = await getAuth().catch(() => null);
  const requestHeaders = await headers().catch(() => null);
  if (!auth || !requestHeaders) return { status: "error", error: "resetFailed" };

  try {
    await auth.api.setUserPassword({
      body: { userId: parsed.data.userId, newPassword: parsed.data.newPassword },
      headers: requestHeaders,
    });
  } catch {
    return { status: "error", error: "resetFailed" };
  }

  try {
    await auth.api.revokeUserSessions({
      body: { userId: parsed.data.userId },
      headers: requestHeaders,
    });
  } catch {
    return { status: "error", error: "sessionRevokeFailed" };
  }

  return { status: "success", error: null };
}

export async function toggleUserStatus(id: string, status: string) {
  await requireAdmin();
  const db = await getDb();
  await db.update(S().user).set({ status }).where(eq(S().user.id, id));
  revalidatePath("/admin", "layout");
}
