/**
 * Provider 注册表 —— 把 ResolvedRoute(解密后的上游配置)转成 AI SDK LanguageModel。
 *
 * AI SDK V4(ai@7):
 *   openai            → createOpenAI({ baseURL, apiKey }).chat(model)
 *   openai-compatible → createOpenAICompatible({ baseURL, apiKey }).chatModel(model)
 *   anthropic         → createAnthropic({ baseURL, apiKey }).chat(model)
 *   gemini            → createGoogle({ baseURL, apiKey })(model)
 *
 * 每次请求新建 provider 实例(因为 baseURL/apiKey 来自 DB,每条路由可能不同)。
 * AI SDK 的 provider 构造很轻,无连接池开销。
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel, ToolSet } from "ai";
import type { ResolvedRoute } from "./types";
import {
  defaultRouteApiFormat,
  type RouteApiFormat,
} from "@/db/types";
import type { ReasoningLevel } from "@/db/types";
import { applyReasoningToCompatibleBody } from "@/lib/reasoning";
import {
  isHostedSearchRouteCompatible,
  type SearchTimeRange,
} from "@/lib/web-search/types";

/** 从 ResolvedRoute 构造 AI SDK LanguageModel(V4,兼容 ai@7)。 */
export function buildLanguageModel(route: ResolvedRoute): LanguageModel {
  return buildLanguageModelWithKey(route, route.provider.apiKey);
}

/** 包装 fetch,强制覆盖 user-agent(AI SDK 内部 UA 无法用 headers 覆盖,需在 fetch 层 set)。 */
function withUAFetch(ua: string) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("user-agent", ua);
    return globalThis.fetch(url, init ? { ...init, headers } : { headers });
  };
}

const AUTH_HEADERS = new Set(["authorization", "x-api-key", "x-goog-api-key"]);

/** 合并自定义 header，但认证凭据只能由目标 wire protocol 的 SDK 注入。 */
function getSafeHeaders(route: ResolvedRoute): Record<string, string> {
  const merged = { ...(route.provider.headers ?? {}), ...(route.headers ?? {}) };
  for (const name of Object.keys(merged)) {
    if (AUTH_HEADERS.has(name.toLowerCase())) delete merged[name];
  }
  return merged;
}

export function resolveRouteApiFormat(route: ResolvedRoute): RouteApiFormat {
  return route.apiFormat ?? defaultRouteApiFormat(route.protocol);
}

/** 用指定 api key 构造 LanguageModel(stream.ts 换 key 重试时调用)。 */
export function buildLanguageModelWithKey(
  route: ResolvedRoute,
  apiKey: string,
  /** 会话级 cache key;openai-compatible 时注入 session affinity header,缺省不注入。 */
  cacheKey?: string,
  reasoning?: ReasoningLevel,
  /** 覆盖上游请求 User-Agent(AI SDK 默认 UA 无法用 headers 覆盖,需 customFetch)。 */
  userAgent?: string,
): LanguageModel {
  const { protocol, provider, upstreamModelName } = route;
  const { baseUrl } = provider;

  const commonHeaders = getSafeHeaders(route);
  const fetchOpts = userAgent ? { fetch: withUAFetch(userAgent) } : {};
  const apiFormat = resolveRouteApiFormat(route);

  switch (apiFormat) {
    case "openai-chat": {
      if (protocol === "openai-compatible") {
        const sessionHeaders: Record<string, string> = cacheKey
          ? { session_id: cacheKey, "x-client-request-id": cacheKey, "x-session-affinity": cacheKey }
          : {};
        const providerInstance = createOpenAICompatible({
          name: provider.id,
          baseURL: baseUrl,
          apiKey,
          headers: { ...commonHeaders, ...sessionHeaders },
          ...fetchOpts,
          includeUsage: provider.supportsStreamUsage !== false,
          transformRequestBody: (body) => applyReasoningToCompatibleBody(body, route.capabilities, reasoning),
        });
        return providerInstance.chatModel(upstreamModelName);
      }
      // OpenAI 官方:createOpenAI 对 reasoning 模型(o1/o3/gpt-5 等)会把 system
      // 消息发成 developer role,这是官方约定,官方上游接受。
      const providerInstance = createOpenAI({
        baseURL: baseUrl,
        apiKey,
        name: provider.id,
        headers: commonHeaders,
        ...fetchOpts,
      });
      return providerInstance.chat(upstreamModelName);
    }
    case "openai-responses": {
      const providerInstance = createOpenAI({
        baseURL: baseUrl,
        apiKey,
        name: provider.id,
        headers: commonHeaders,
        ...fetchOpts,
      });
      return providerInstance.responses(upstreamModelName);
    }
    case "anthropic-messages": {
      const providerInstance = createAnthropic({
        baseURL: baseUrl,
        apiKey,
        headers: commonHeaders,
        ...fetchOpts,
      });
      return providerInstance.messages(upstreamModelName);
    }
    case "gemini-generate-content": {
      const providerInstance = createGoogle({
        baseURL: baseUrl,
        apiKey,
        headers: commonHeaders,
        ...fetchOpts,
      });
      return providerInstance(upstreamModelName);
    }
    default:
      throw new Error(`当前 Chat operation 不支持 route API 格式:${apiFormat}`);
  }
}

export interface HostedSearchRuntime {
  model: LanguageModel;
  tools: ToolSet;
}

/** 按目录声明构造搜索专用模型；协议不匹配时跳过该路由。 */
export function buildHostedSearchRuntime(
  route: ResolvedRoute,
  apiKey: string,
  userAgent?: string,
  timeRange?: SearchTimeRange,
): HostedSearchRuntime | null {
  const format = route.capabilities?.webSearchFormat;
  const { provider, upstreamModelName } = route;
  const fetchOpts = userAgent ? { fetch: withUAFetch(userAgent) } : {};
  const common = {
    baseURL: provider.baseUrl,
    apiKey,
    headers: provider.headers ?? {},
    ...fetchOpts,
  };

  if (!route.supportsTools || !format || !isHostedSearchRouteCompatible(format, route.protocol)) {
    return null;
  }

  if (format === "openai") {
    const instance = createOpenAI({ ...common, name: provider.id });
    return {
      model: instance.responses(upstreamModelName),
      tools: { web_search: instance.tools.webSearch({ searchContextSize: "medium" }) },
    };
  }
  if (format === "anthropic") {
    const instance = createAnthropic(common);
    return {
      model: instance.messages(upstreamModelName),
      tools: { web_search: instance.tools.webSearch_20250305({ maxUses: 3 }) },
    };
  }
  if (format === "google") {
    const instance = createGoogle(common);
    const timeRangeFilter = timeRange
      ? {
          startTime: `${timeRange.startDate}T00:00:00.000Z`,
          endTime: `${timeRange.endDate}T23:59:59.999Z`,
        }
      : undefined;
    return {
      model: instance(upstreamModelName),
      tools: {
        google_search: instance.tools.googleSearch({
          searchTypes: { webSearch: {} },
          ...(timeRangeFilter ? { timeRangeFilter } : {}),
        }),
      },
    };
  }
  if (format === "xai") {
    const instance = createXai(common);
    return {
      model: instance.responses(upstreamModelName),
      tools: { web_search: instance.tools.webSearch() },
    };
  }
  return null;
}
