/** 联网搜索公共类型。 */

import type { CallContext } from "@/lib/providers/types";
import type { ProviderProtocol, WebSearchFormat } from "@/db/types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class SearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

export interface SearchProvider {
  name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}

export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchBundle {
  results: SearchResult[];
  hit: boolean;
  reason?: string;
  backend?: SearchBackendIdentity;
  groundedSummary?: string;
  attempts?: SearchAttempt[];
}

export interface SearchAttempt {
  backend: SearchBackendIdentity;
  outcome: string;
  durationMs: number;
}

export interface SearchToolResult {
  query: string;
  groundedSummary: string;
  citations: SearchResult[];
  backend: SearchBackendIdentity;
  attempts: SearchAttempt[];
}

export interface SearchWebExecutionOptions {
  ctx: CallContext;
  runId: string;
  toolCallId: string;
  currentModelId?: string;
  currentModelName: string;
  signal: AbortSignal;
}

export type WebSearchProviderType = "tavily" | "bocha" | "zhipu" | "searxng";

export type SearchBackend =
  | { type: "current-model" }
  | { type: "model"; modelId: string }
  | { type: "provider"; providerId: string };

export interface SearchBackendIdentity {
  type: SearchBackend["type"];
  id?: string;
  name: string;
}

/** 服务端运行时配置。apiKey 只存在于服务端内存。 */
export interface WebSearchProviderConfig {
  id: string;
  type: WebSearchProviderType;
  name: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  enabled: boolean;
}

/** 数据库存储结构。 */
export interface StoredWebSearchProviderConfig extends Omit<WebSearchProviderConfig, "apiKey"> {
  apiKeyCiphertext?: string;
}

/** 下发客户端的脱敏结构。 */
export interface WebSearchProviderDto extends Omit<WebSearchProviderConfig, "apiKey"> {
  hasApiKey: boolean;
}

export interface WebSearchConfig {
  version: 2;
  providers: WebSearchProviderConfig[];
  backends: SearchBackend[];
}

export interface StoredWebSearchConfig {
  version: 2;
  providers: StoredWebSearchProviderConfig[];
  backends: SearchBackend[];
}

export interface WebSearchConfigDto {
  version: 2;
  providers: WebSearchProviderDto[];
  backends: SearchBackend[];
}

/** 设置页可选的搜索模型；能力与可执行路由均已由服务端校验。 */
export interface WebSearchModelCandidate {
  id: string;
  name: string;
  displayName?: string;
}

export interface ResolvedExternalSearchBackend {
  backend: Extract<SearchBackend, { type: "provider" }>;
  identity: SearchBackendIdentity;
  provider: SearchProvider;
  cacheKey: string;
}

export function searchBackendKey(backend: SearchBackend): string {
  if (backend.type === "current-model") return backend.type;
  return `${backend.type}:${backend.type === "model" ? backend.modelId : backend.providerId}`;
}

/** 目录搜索语义与上游路由协议的已实现兼容矩阵。 */
export function isHostedSearchRouteCompatible(
  format: WebSearchFormat,
  protocol: ProviderProtocol,
): boolean {
  return (
    (format === "openai" && protocol === "openai")
    || (format === "anthropic" && protocol === "anthropic")
    || (format === "google" && protocol === "gemini")
    || (format === "xai" && protocol === "openai-compatible")
  );
}
