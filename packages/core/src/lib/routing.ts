/**
 * 模型路由 —— 解析"对外模型 → 可调用的上游路由链"。
 *
 * 统一资源模型后,providers/models/routes 合并为三张表,用 ownerUserId + visibility 表达
 * 归属与可见性。两条解析入口:
 *   - resolveRoutes(ctx, modelName):网关路径,by name + owner-only(只调自己创建的模型)。
 *   - resolveRoutesById(ctx, modelId):WebChat 路径,by id + 可见性(public ∪ owner)。
 *
 * 核心逻辑:
 *   1. 定位模型(网关 by name+owner;WebChat by id + 可见性校验)
 *   2. 查 routes(join providers,可能多条,按 priority 分组,组内按 weight 加权)
 *   3. 鉴权:主 key / WebChat 用户 → 全部可见集;子 key → 仅绑定集
 *   4. 返回有序路由链(优先级升序,组内按权重分布);调用方按序尝试,失败故障转移
 *
 * 加密 provider key 在此解密(仅运行时持有)。
 *
 * P1-D 扩展:resolveRoutesByCapability —— 按 ModelCapabilities 字段(imageGeneration /
 * audioTranscription / audioSynthesis)解析路由,供图像/语音端点复用路由链与故障转移。
 */
import { eq, and, or } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { parseKeyBundle, pickWeightedKey } from "@/lib/providers/keys";
import {
  getProviderAvailability,
  recordNoHealthyRoute,
} from "@/lib/circuit-breaker";
import { getRouteRepository } from "@/lib/repositories/route-repository";
import type {
  ResolvedRoute,
  ResolvedProvider,
  CallContext,
} from "@/lib/providers/types";
import type { ModelCapabilities } from "@/db/types";

/** 解析加密 key bundle,返回加权 key 列表(已向后兼容历史格式)。 */
function resolveProviderKeys(encBundle: string) {
  return parseKeyBundle(encBundle);
}

/** 把 provider 行规整为运行时 ResolvedProvider。密钥列统一为 apiKeysEnc。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResolvedProvider(row: any): ResolvedProvider {
  const keys = resolveProviderKeys(row.apiKeysEnc);
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    keys,
    apiKey: pickWeightedKey(keys),
    connectTimeoutMs: row.connectTimeoutMs ?? undefined,
    readTimeoutMs: row.readTimeoutMs ?? undefined,
    streamIdleTimeoutMs: row.streamIdleTimeoutMs ?? undefined,
    headers: (row.headersJson as Record<string, string>) ?? undefined,
    supportsStreamUsage: row.supportsStreamUsage ?? null,
  };
}

/**
 * 网关路径:按对外模型名解析路由链(owner-only)。
 *
 * 网关只能调调用者自己创建的模型(by name + ownerUserId),public 对网关不可见。
 *
 * @returns 路由链(至少 1 条);找不到抛错。
 *          顺序:priority 升序,同 priority 内按 weight 加权随机。
 *          调用方按序尝试,失败则切换下一条(故障转移)。
 */
export async function resolveRoutes(
  ctx: CallContext,
  modelName: string,
): Promise<ResolvedRoute[]> {
  const repo = getRouteRepository();

  // --- 子 key 绑定约束(null = 不限) ---
  let allowedModelIds: Set<string> | null = null;
  if (ctx.keyKind === "sub" && ctx.apiKeyId) {
    const bindings = await repo.findKeyModelBindings(ctx.apiKeyId);
    allowedModelIds = bindings.modelIds;
  }

  // --- 网关 owner-only:by name + ownerUserId ---
  const model = await repo.findEnabledModelByNameForOwner(modelName, ctx.userId);
  if (!model) {
    throw new RoutingError("model_not_found", `模型 ${modelName} 不存在或未启用`);
  }

  if (allowedModelIds !== null && !allowedModelIds.has(model.id)) {
    throw new RoutingError("model_not_bound", `模型 ${modelName} 未绑定到该 key`);
  }

  return resolveModelRoutes(model);
}

/**
 * WebChat 路径:按 modelId 解析路由链(可见性校验)。
 *
 * 可见 = visibility=public ∪ (private && owner=自己);不满足则 model_not_found
 * (不泄露存在性)。WebChat 传 modelId 而非 name,避免 public/private 同名歧义。
 */
export async function resolveRoutesById(
  ctx: CallContext,
  modelId: string,
): Promise<ResolvedRoute[]> {
  const repo = getRouteRepository();

  // --- 子 key 绑定约束(null = 不限) ---
  let allowedModelIds: Set<string> | null = null;
  if (ctx.keyKind === "sub" && ctx.apiKeyId) {
    const bindings = await repo.findKeyModelBindings(ctx.apiKeyId);
    allowedModelIds = bindings.modelIds;
  }

  const model = await repo.findEnabledModelById(modelId);
  if (!model) {
    throw new RoutingError("model_not_found", `模型 ${modelId} 不存在或未启用`);
  }

  // 可见性:public 或 owner=自己,否则视为不存在。
  if (model.visibility !== "public" && model.ownerUserId !== ctx.userId) {
    throw new RoutingError("model_not_found", `模型 ${modelId} 不存在或未启用`);
  }

  if (allowedModelIds !== null && !allowedModelIds.has(model.id)) {
    throw new RoutingError("model_not_bound", `模型 ${model.name} 未绑定到该 key`);
  }

  return resolveModelRoutes(model);
}

/** 模型 → 有序路由链(查 routes join providers,按 priority/weight)。 */
async function resolveModelRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
): Promise<ResolvedRoute[]> {
  const repo = getRouteRepository();

  const routes = await repo.findEnabledRoutes(model.id);

  if (routes.length === 0) {
    throw new RoutingError("no_route", `模型 ${model.name} 没有可用路由`);
  }

  // source 语义基于 visibility:public→"global"、private→"byo"(供 usage 日志/前端 badge 复用)。
  const source: ResolvedRoute["source"] =
    model.visibility === "public" ? "global" : "byo";

  const resolved: ResolvedRoute[] = routes.map(
    (row: { route: Record<string, unknown>; provider: Record<string, unknown> }) => ({
      modelName: model.name,
      upstreamModelName: row.route.upstreamModelName as string,
      apiFormat: row.route.apiFormat as ResolvedRoute["apiFormat"],
      // Provider protocol 只保留为连接类型；普通聊天 wire format 读取 apiFormat。
      protocol: row.provider.protocol as ResolvedRoute["protocol"],
      provider: toResolvedProvider(row.provider),
      headers: (row.route.headersJson as Record<string, string>) ?? undefined,
      priority: row.route.priority as number,
      weight: row.route.weight as number,
      source,
      routeId: row.route.id as string,
      modelId: model.id,
      capabilities: model.capabilities,
      supportsTools: row.route.supportsTools === true,
    }),
  );

  return filterByCircuitBreaker(orderRoutes(resolved));
}

/**
 * 路由排序:按 priority 升序;同 priority 组内按 weight 加权随机选顺序。
 * 故障转移时调用方从前往后尝试。
 */
function orderRoutes(routes: ResolvedRoute[]): ResolvedRoute[] {
  const groups = new Map<number, ResolvedRoute[]>();
  for (const r of routes) {
    const g = groups.get(r.priority) ?? [];
    g.push(r);
    groups.set(r.priority, g);
  }
  const sortedPriorities = [...groups.keys()].sort((a, b) => a - b);
  const result: ResolvedRoute[] = [];
  for (const p of sortedPriorities) {
    result.push(...weightedShuffle(groups.get(p)!));
  }
  return result;
}

/** 熔断过滤只读取可用性，探针所有权由 Gateway Engine 获取。 */
function filterByCircuitBreaker(routes: ResolvedRoute[]): ResolvedRoute[] {
  const allowed = routes.filter((route) => {
    const availability = getProviderAvailability(route.provider.id);
    return availability === "closed" || availability === "probe_ready";
  });
  if (allowed.length > 0) return allowed;
  recordNoHealthyRoute();
  throw new RoutingError("no_healthy_route", "模型没有健康的可用路由");
}

/** 按 weight 做加权随机抽取(无放回),返回打乱后的顺序。 */
function weightedShuffle(items: ResolvedRoute[]): ResolvedRoute[] {
  const remaining = [...items];
  const out: ResolvedRoute[] = [];
  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, r) => sum + Math.max(r.weight, 0), 0);
    if (totalWeight <= 0) {
      out.push(...remaining);
      break;
    }
    let pick = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      pick -= Math.max(remaining[idx].weight, 0);
      if (pick <= 0) break;
    }
    out.push(remaining.splice(Math.min(idx, remaining.length - 1), 1)[0]);
  }
  return out;
}

/** 路由错误(带稳定 code,供调用方/前端区分)。 */
export class RoutingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RoutingError";
  }
}

// ===========================================================================
// P1-D:能力路由 —— 供图像生成 / 语音端点复用
// ===========================================================================

/**
 * 按"对外模型名 + 期望能力"解析路由链。
 *
 * 复用 resolveRoutes 拿到路由链(含全局/BYO、子 key 绑定、加权故障转移),
 * 再校验该模型的 capabilities 是否具备期望能力(如 imageGeneration)。
 * 不具备则抛 capability_not_supported。
 *
 * @param capability 期望的能力字段名(ModelCapabilities 的 boolean 键)。
 */
export async function resolveRoutesByCapability(
  ctx: CallContext,
  modelName: string,
  capability: keyof ModelCapabilities,
): Promise<ResolvedRoute[]> {
  const routes = await resolveRoutes(ctx, modelName);
  // capabilities 在 resolveModelRoutes 时已填入 route[0]。
  const caps = routes[0]?.capabilities;
  if (!caps || !caps[capability]) {
    throw new RoutingError(
      "capability_not_supported",
      `模型 ${modelName} 不支持能力 ${capability}`,
    );
  }
  return routes;
}

/**
 * 列出具备某能力的全部对外模型名(供 /v1/models 类端点过滤展示)。
 * 返回 public 模型 ∪ 调用者自己的 private 模型,source 基于 visibility。
 */
export async function listModelsByCapability(
  ctx: CallContext,
  capability: keyof ModelCapabilities,
): Promise<{ name: string; source: "global" | "byo" }[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // capabilities 位于模型目录 JSON 列,用 like 做能力存在性过滤。
  // PG 的 jsonb 隐式转 text 后支持字符串 like。
  const rows = await db
    .select({
      name: s.models.name,
      visibility: s.models.visibility,
      capabilities: s.modelCatalog.capabilities,
    })
    .from(s.models)
    .innerJoin(s.modelCatalog, eq(s.models.catalogId, s.modelCatalog.id))
    .where(
      and(
        eq(s.models.enabled, true),
        or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, ctx.userId)),
      ),
    );

  return rows
    .filter((r: { capabilities: ModelCapabilities }) => Boolean(r.capabilities?.[capability]))
    .map((r: { name: string; visibility: string }) => ({
    name: r.name,
    source: r.visibility === "public" ? ("global" as const) : ("byo" as const),
  }));
}
