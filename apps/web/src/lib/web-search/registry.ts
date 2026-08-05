import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import type { ModelCapabilities, ProviderProtocol } from "@/db/types";
import { getDb, getSchema } from "@/lib/infra/db";
import { decrypt, encrypt, hashSecret } from "@/lib/infra/crypto";
import { assertPublicHttpUrl } from "./public-http";
import type {
  ResolvedExternalSearchBackend,
  SearchBackend,
  SearchProvider,
  StoredWebSearchConfig,
  WebSearchConfig,
  WebSearchConfigDto,
  WebSearchModelCandidate,
  WebSearchProviderConfig,
} from "./types";
import { isHostedSearchRouteCompatible, searchBackendKey } from "./types";
import { createTavilyProvider } from "./tavily";
import { createBochaProvider } from "./bocha";
import { createZhipuProvider } from "./zhipu";
import { createSearxngProvider } from "./searxng";

const WEB_SEARCH_KEY = "web_search";
const TTL = 60_000;

const providerBaseSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["tavily", "bocha", "zhipu", "searxng"]),
  name: z.string().min(1),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean(),
});

const backendSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("current-model") }),
  z.object({ type: z.literal("model"), modelId: z.string().min(1) }),
  z.object({ type: z.literal("provider"), providerId: z.string().min(1) }),
]);

const v1Schema = z.object({
  version: z.literal(1),
  providers: z.array(providerBaseSchema.extend({ apiKey: z.string().optional() })),
});

const v2Schema = z.object({
  version: z.literal(2),
  providers: z.array(providerBaseSchema.extend({ apiKeyCiphertext: z.string().optional() })),
  backends: z.array(backendSchema),
});

const cache = new Map<string, { config: WebSearchConfig | null; ts: number }>();

export function createDefaultWebSearchConfig(): WebSearchConfig {
  return { version: 2, providers: [], backends: [{ type: "current-model" }] };
}

function dedupeBackends(backends: SearchBackend[]): SearchBackend[] {
  const seen = new Set<string>();
  return backends.filter((backend) => {
    const key = searchBackendKey(backend);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 解析数据库 JSON；V1 保持 Provider 相对顺序并追加 current-model。 */
export function parseWebSearchConfig(value: unknown): WebSearchConfig | null {
  const v2 = v2Schema.safeParse(value);
  if (v2.success) {
    return {
      version: 2,
      providers: v2.data.providers.map(({ apiKeyCiphertext, ...provider }) => ({
        ...provider,
        apiKey: apiKeyCiphertext ? decrypt(apiKeyCiphertext) : undefined,
      })),
      backends: dedupeBackends(v2.data.backends),
    };
  }

  const v1 = v1Schema.safeParse(value);
  if (!v1.success) return null;
  return {
    version: 2,
    providers: v1.data.providers,
    backends: [
      ...v1.data.providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({ type: "provider" as const, providerId: provider.id })),
      { type: "current-model" },
    ],
  };
}

export function serializeWebSearchConfig(config: WebSearchConfig): StoredWebSearchConfig {
  return {
    version: 2,
    providers: config.providers.map(({ apiKey, ...provider }) => ({
      ...provider,
      apiKeyCiphertext: apiKey ? encrypt(apiKey) : undefined,
    })),
    backends: dedupeBackends(config.backends),
  };
}

export type WebSearchConfigBackfillPlan =
  | { status: "convert"; stored: StoredWebSearchConfig; providerCount: number }
  | { status: "up-to-date" }
  | { status: "invalid"; legacy: boolean };

/** 识别并转换单条历史配置；不执行数据库写入。 */
export function planWebSearchConfigBackfill(value: unknown): WebSearchConfigBackfillPlan {
  const v2 = v2Schema.safeParse(value);
  if (v2.success) return { status: "up-to-date" };
  const v1 = v1Schema.safeParse(value);
  if (!v1.success) {
    return {
      status: "invalid",
      legacy: Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 1),
    };
  }
  const runtime = parseWebSearchConfig(v1.data);
  if (!runtime) return { status: "invalid", legacy: true };
  return {
    status: "convert",
    stored: serializeWebSearchConfig(runtime),
    providerCount: runtime.providers.filter((provider) => Boolean(provider.apiKey)).length,
  };
}

export function toWebSearchConfigDto(config: WebSearchConfig): WebSearchConfigDto {
  return {
    version: 2,
    providers: config.providers.map(({ apiKey, ...provider }) => ({
      ...provider,
      hasApiKey: Boolean(apiKey),
    })),
    backends: structuredClone(config.backends),
  };
}

/** 返回当前用户可调用且具有已实现 Hosted Search 路由的模型。 */
export async function listWebSearchModelCandidates(
  userId: string,
): Promise<WebSearchModelCandidate[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = (await db
    .select({
      id: s.models.id,
      name: s.models.name,
      displayName: s.models.displayName,
      capabilities: s.modelCatalog.capabilities,
      protocol: s.providers.protocol,
      supportsTools: s.routes.supportsTools,
    })
    .from(s.models)
    .innerJoin(s.modelCatalog, eq(s.models.catalogId, s.modelCatalog.id))
    .innerJoin(s.routes, and(eq(s.routes.modelId, s.models.id), eq(s.routes.enabled, true)))
    .innerJoin(s.providers, and(eq(s.routes.providerId, s.providers.id), eq(s.providers.enabled, true)))
    .where(and(
      eq(s.models.enabled, true),
      eq(s.modelCatalog.enabled, true),
      or(eq(s.models.visibility, "public"), eq(s.models.ownerUserId, userId)),
    ))) as Array<{
    id: string;
    name: string;
    displayName: string | null;
    capabilities: ModelCapabilities | null;
    protocol: ProviderProtocol;
    supportsTools: boolean;
  }>;

  const candidates = new Map<string, WebSearchModelCandidate>();
  for (const row of rows) {
    const format = row.capabilities?.webSearchFormat;
    if (!row.supportsTools || !format || !isHostedSearchRouteCompatible(format, row.protocol)) continue;
    candidates.set(row.id, {
      id: row.id,
      name: row.name,
      ...(row.displayName ? { displayName: row.displayName } : {}),
    });
  }
  return Array.from(candidates.values());
}

export async function loadConfig(userId: string): Promise<WebSearchConfig | null> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.ts < TTL) return structuredClone(cached.config);
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select({ value: s.userSettings.value })
    .from(s.userSettings)
    .where(and(eq(s.userSettings.userId, userId), eq(s.userSettings.key, WEB_SEARCH_KEY)))
    .limit(1);
  let config: WebSearchConfig | null = null;
  const raw = rows[0]?.value;
  if (raw) {
    try {
      config = parseWebSearchConfig(JSON.parse(raw));
    } catch {
      config = null;
    }
  }
  cache.set(userId, { config, ts: Date.now() });
  return structuredClone(config);
}

function buildProvider(provider: WebSearchProviderConfig): SearchProvider | null {
  switch (provider.type) {
    case "tavily":
      return provider.apiKey ? createTavilyProvider(provider.apiKey) : null;
    case "bocha":
      return provider.apiKey ? createBochaProvider(provider.apiKey) : null;
    case "zhipu":
      return provider.apiKey ? createZhipuProvider(provider.apiKey, provider.model) : null;
    case "searxng":
      return provider.baseUrl ? createSearxngProvider(provider.baseUrl) : null;
  }
}

export async function resolveExternalSearchBackends(userId: string): Promise<ResolvedExternalSearchBackend[]> {
  const config = await loadConfig(userId);
  if (!config) return [];
  const providers = new Map(config.providers.map((provider) => [provider.id, provider]));
  return config.backends.flatMap((backend) => {
    if (backend.type !== "provider") return [];
    const configProvider = providers.get(backend.providerId);
    if (!configProvider?.enabled) return [];
    const provider = buildProvider(configProvider);
    if (!provider) return [];
    const secretFingerprint = hashSecret(configProvider.apiKey ?? configProvider.baseUrl ?? "").slice(0, 16);
    return [{
      backend,
      identity: { type: "provider" as const, id: configProvider.id, name: configProvider.name },
      provider,
      cacheKey: `${configProvider.id}:${secretFingerprint}`,
    }];
  });
}

/** 旧调用方兼容：返回排序后的首个外接 Provider。 */
export async function resolveProvider(userId: string): Promise<SearchProvider | null> {
  return (await resolveExternalSearchBackends(userId))[0]?.provider ?? null;
}

export async function isWebSearchEnabled(userId: string): Promise<boolean> {
  const config = await loadConfig(userId);
  return Boolean(config?.backends.length);
}

export function clearWebSearchConfigCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function saveWebSearchConfig(userId: string, config: WebSearchConfig): Promise<void> {
  for (const provider of config.providers) {
    if (provider.type === "searxng" && provider.baseUrl) await assertPublicHttpUrl(provider.baseUrl);
  }
  const stored = serializeWebSearchConfig({ ...config, backends: dedupeBackends(config.backends) });
  const value = JSON.stringify(stored);
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db
    .insert(s.userSettings)
    .values({ userId, key: WEB_SEARCH_KEY, value })
    .onConflictDoUpdate({
      target: [s.userSettings.userId, s.userSettings.key],
      set: { value, updatedAt: new Date() },
    });
  clearWebSearchConfigCache(userId);
}
