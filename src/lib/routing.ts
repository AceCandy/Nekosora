/**
 * 模型路由 —— 解析"对外模型名 → 可调用的上游路由链"。
 *
 * 核心逻辑:
 *   1. 判断模型属于全局(global_models)还是 BYO(user_models)
 *   2. 全局模型:查 global_routes(可能多条,按 priority 分组,组内按 weight 加权)
 *      → 每条 route 关联 global_providers(含 base_url + 加密 key)
 *   3. BYO 模型:查 user_models + user_providers
 *   4. 鉴权:主 key / WebChat 用户 → 全部可见集;子 key → 仅绑定集
 *   5. 返回有序路由链(优先级升序,组内按权重分布);调用方按序尝试,失败故障转移
 *
 * 加密 provider key 在此解密(仅运行时持有)。
 *
 * P1-D 扩展:resolveRoutesByCapability —— 按 ModelCapabilities 字段(imageGeneration /
 * audioTranscription / audioSynthesis)解析路由,供图像/语音端点复用路由链与故障转移。
 */
import { eq, and, asc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { parseKeyBundle, pickWeightedKey } from "@/lib/providers/keys";
import { isProviderAllowed } from "@/lib/circuit-breaker";
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

/** 把 provider 行(global/user)规整为运行时 ResolvedProvider。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResolvedProvider(row: any, keyField: string): ResolvedProvider {
  const keys = resolveProviderKeys(row[keyField]);
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    keys,
    apiKey: pickWeightedKey(keys),
    connectTimeoutMs: row.connectTimeoutMs ?? undefined,
    readTimeoutMs: row.readTimeoutMs ?? undefined,
    headers: (row.headersJson as Record<string, string>) ?? undefined,
  };
}

/**
 * 解析模型名 → 有序路由链。
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

  // --- 1. 判断是否为子 key,以及绑定约束 ---
  let allowedGlobalModelIds: Set<string> | null = null; // null = 不限
  let allowedUserModelIds: Set<string> | null = null;

  if (ctx.keyKind === "sub" && ctx.apiKeyId) {
    const bindings = await repo.findKeyModelBindings(ctx.apiKeyId);
    allowedGlobalModelIds = bindings.globalModelIds;
    allowedUserModelIds = bindings.userModelIds;
  }

  // --- 2. 尝试全局模型 ---
  const globalModel = await repo.findEnabledGlobalModel(modelName);

  if (globalModel) {
    // access_scope=internal 的模型不对外开放(仅系统任务用)。
    if (globalModel.accessScope === "internal" && ctx.source === "gateway") {
      throw new RoutingError("model_not_available", `模型 ${modelName} 不可用`);
    }
    // 子 key 校验绑定
    if (allowedGlobalModelIds !== null && !allowedGlobalModelIds.has(globalModel.id)) {
      throw new RoutingError("model_not_bound", `模型 ${modelName} 未绑定到该 key`);
    }
    return resolveGlobalRoutes(globalModel);
  }

  // --- 3. 尝试用户 BYO 模型(仅该用户的) ---
  const userModel = await repo.findEnabledUserModel(modelName, ctx.userId);

  if (userModel) {
    if (allowedUserModelIds !== null && !allowedUserModelIds.has(userModel.id)) {
      throw new RoutingError("model_not_bound", `模型 ${modelName} 未绑定到该 key`);
    }
    return resolveByoRoute(userModel);
  }

  throw new RoutingError(
    "model_not_found",
    `模型 ${modelName} 不存在或未启用`,
  );
}

/** 全局模型 → 路由链(多条 global_routes 按 priority/weight)。 */
async function resolveGlobalRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalModel: any,
): Promise<ResolvedRoute[]> {
  const repo = getRouteRepository();

  const routes = await repo.findEnabledGlobalRoutes(globalModel.id);

  if (routes.length === 0) {
    throw new RoutingError("no_route", `模型 ${globalModel.name} 没有可用路由`);
  }

  const resolved: ResolvedRoute[] = routes.map(
    (row: { route: Record<string, unknown>; provider: Record<string, unknown> }) => ({
      modelName: globalModel.name,
      upstreamModelName: row.route.upstreamModelName as string,
      // 协议归属 provider,路由不再单独存(与 BYO 路径一致)。
      protocol: row.provider.protocol as ResolvedRoute["protocol"],
      provider: toResolvedProvider(row.provider, "apiKeysEnc"),
      priority: row.route.priority as number,
      weight: row.route.weight as number,
      source: "global" as const,
      routeId: row.route.id as string,
      globalModelId: globalModel.id,
      capabilities: globalModel.capabilities,
    }),
  );

  return filterByCircuitBreaker(orderRoutes(resolved));
}

/**
 * BYO 模型 → 多路由链(与全局分支同构)。
 *
 * 查 user_routes(join user_providers)→ 映射 ResolvedRoute[] →
 * orderRoutes(priority/weight)+ filterByCircuitBreaker(熔断过滤)。
 * 与 resolveGlobalRoutes 的差异仅在:source="byo"、密钥列名 apiKeyEnc
 * (比全局 apiKeysEnc 少一个 s)、id 字段 userModelId。
 */
async function resolveByoRoute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userModel: any,
): Promise<ResolvedRoute[]> {
  const repo = getRouteRepository();

  const routes = await repo.findEnabledUserRoutes(userModel.id);

  if (routes.length === 0) {
    throw new RoutingError("no_route", `模型 ${userModel.name} 没有可用路由`);
  }

  const resolved: ResolvedRoute[] = routes.map(
    (row: { route: Record<string, unknown>; provider: Record<string, unknown> }) => ({
      modelName: userModel.name,
      upstreamModelName: row.route.upstreamModelName as string,
      protocol: row.provider.protocol as ResolvedRoute["protocol"],
      provider: toResolvedProvider(row.provider, "apiKeyEnc"),
      priority: row.route.priority as number,
      weight: row.route.weight as number,
      source: "byo" as const,
      routeId: row.route.id as string,
      userModelId: userModel.id,
      capabilities: userModel.capabilities,
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

/**
 * 熔断过滤:跳过处于 open 态的 provider 的路由。
 *
 * 若全部路由对应的 provider 都被熔断,降级返回原始全集——
 * 避免单 provider 故障导致整个模型对所有用户 503(雪崩)。
 * 调用方仍会逐条尝试,撞墙的错误由 streamChat 的故障转移处理。
 */
function filterByCircuitBreaker(routes: ResolvedRoute[]): ResolvedRoute[] {
  const allowed = routes.filter((r) => isProviderAllowed(r.provider.id));
  return allowed.length > 0 ? allowed : routes;
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
  // capabilities 在 resolveGlobalRoutes/resolveByoRoute 时已填入 route[0]。
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
 * 仅返回全局 + 当前用户 BYO 中具备该能力的启用模型。
 */
export async function listModelsByCapability(
  ctx: CallContext,
  capability: keyof ModelCapabilities,
): Promise<{ name: string; source: "global" | "byo" }[]> {
  const db = await getDb();
  const schema = getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = schema as any;

  const out: { name: string; source: "global" | "byo" }[] = [];

  // 全局模型:capabilities 是 JSON 列,用 like 做能力存在性过滤(dialect 通用)。
  // SQLite/PG 的 jsonb/text 都支持字符串 like。
  const globalRows = await db
    .select({ name: s.globalModels.name })
    .from(s.globalModels)
    .where(
      and(
        eq(s.globalModels.enabled, true),
        // 能力键存在于 JSON 中且为 true。简化:like 匹配 `"imageGeneration":true`。
        // 不同 dialect 的 JSON 序列化格式可能略有差异,这里宽松匹配键名+true。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s.globalModels.capabilities as any).like(`%"${capability}":true%`),
      ),
    );
  for (const r of globalRows) {
    out.push({ name: r.name, source: "global" });
  }

  // 用户 BYO 模型
  const userRows = await db
    .select({ name: s.userModels.name })
    .from(s.userModels)
    .where(
      and(
        eq(s.userModels.userId, ctx.userId),
        eq(s.userModels.enabled, true),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s.userModels.capabilities as any).like(`%"${capability}":true%`),
      ),
    );
  for (const r of userRows) {
    out.push({ name: r.name, source: "byo" });
  }

  return out;
}
