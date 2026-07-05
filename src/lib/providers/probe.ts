/**
 * 主动探测 —— 配置期对上游 provider 的连通性验证与模型列表拉取。
 *
 * 与运行期的被动熔断(circuit-breaker)互补:被动机制只在真实请求失败时生效,
 * 这里提供"配完即测"的主动能力,避免 key/baseUrl/upstreamModelName 配错后
 * 要等到真实调用才发现。
 *
 * 两个职责:
 *   1. probeProviderKey —— 用一个极小生成请求验证 "key + baseUrl + 协议" 整条链路
 *   2. fetchUpstreamModels —— 直接 fetch 上游 /models 端点拉取真实模型名,防手填出错
 *
 * 协议差异:
 *   - openai/openai-compatible: Bearer 鉴权,{data:[{id}]}
 *   - anthropic:    x-api-key + anthropic-version 鉴权,{data:[{id}]}
 *   - gemini:       key 在 query param,{models:[{name:"models/xxx"}]} 需去前缀
 */
import { generateText } from "ai";
import { buildLanguageModelWithKey } from "@/lib/providers/registry";
import { isKeyAuthError } from "@/lib/stream";
import type { ResolvedRoute } from "@/lib/providers/types";
import type { ProviderProtocol } from "@/db/types";

/** 探测结果。ok=false 时 errorKind 区分认证/网络/未知,供 UI 分类展示。 */
export interface ProbeResult {
  ok: boolean;
  /** 成功时的往返延迟(ms)。 */
  latencyMs?: number;
  /** 失败原因(面向用户的简短描述)。 */
  error?: string;
  /** 失败分类,便于 UI 给出针对性提示。 */
  errorKind?: "auth" | "network" | "unknown";
}

/** 拉取到的上游模型条目(统一为 OpenAI 风格的 id)。 */
export interface UpstreamModel {
  id: string;
}

/** 各协议用于连通性探测的占位模型名(只用于验证 key+baseUrl,不验证具体模型)。 */
const PROBE_MODEL: Record<string, string> = {
  openai: "gpt-4o-mini",
  "openai-compatible": "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-1.5-flash",
};

/**
 * 用极小生成请求探测上游 provider 的 key + baseUrl + 协议是否可用。
 *
 * 相比单独 fetch /models,走完整生成链路更能验证鉴权头格式是否正确
 * (尤其 gemini 无标准 Bearer)。成功返回延迟,失败按 isKeyAuthError 分类。
 *
 * @param upstreamModelName 可选,缺省按协议取占位模型(仅用于连通性探测)。
 */
export async function probeProviderKey(opts: {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  upstreamModelName?: string;
  headers?: Record<string, string>;
}): Promise<ProbeResult> {
  const { protocol, baseUrl, apiKey, headers } = opts;
  if (!apiKey) {
    return { ok: false, error: "缺少 API Key", errorKind: "unknown" };
  }
  if (!baseUrl) {
    return { ok: false, error: "缺少接口地址", errorKind: "unknown" };
  }

  // 决定探测用的模型名:优先调用方传入的 > 上游真实模型列表第一个 > 占位模型。
  // 第三方兼容上游(SiliconFlow 等)模型列表里没有占位模型 gpt-4o-mini,
  // 不传模型名时先拉 /models 取一个真实模型,避免 model_not_found 误判探测失败。
  let probeModelName = opts.upstreamModelName;
  if (!probeModelName) {
    try {
      const upstream = await fetchUpstreamModels({ protocol, baseUrl, apiKey, headers });
      probeModelName = upstream[0]?.id;
    } catch {
      // /models 不规范或不可达:降级占位模型,保持原探测行为。
    }
    probeModelName ??= PROBE_MODEL[protocol] ?? "gpt-4o-mini";
  }

  // 构造一次性 ResolvedRoute(mock),复用 registry 的协议构建逻辑。
  const route: ResolvedRoute = {
    modelName: "__probe__",
    upstreamModelName: probeModelName,
    protocol,
    provider: {
      id: "__probe__",
      protocol,
      baseUrl,
      apiKey,
      keys: [{ key: apiKey, weight: 1 }],
      headers,
    },
    priority: 0,
    weight: 1,
    source: "global",
  };

  const startedAt = Date.now();
  try {
    const model = buildLanguageModelWithKey(route, apiKey);
    await generateText({
      model,
      prompt: "hi",
      maxOutputTokens: 1,
    });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorKind: ProbeResult["errorKind"] = isKeyAuthError(err)
      ? "auth"
      : isNetworkError(err)
        ? "network"
        : "unknown";
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: msg,
      errorKind,
    };
  }
}

/** 判断错误是否为网络/超时类(非鉴权、非业务逻辑)。 */
function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return /fetch failed|econnrefused|enetunreach|timeout|timed out|aborted|network|err_(network|connection|internet)|socket hang up|getaddrinfo|bad gateway|502|503|504/i.test(msg);
}

/**
 * 拉取上游 provider 的真实模型列表(直接 fetch /models,不走 AI SDK)。
 *
 * AI SDK 的 provider 实例不暴露 listModels,故按协议差异自行请求。
 * 自定义上游若 /models 不规范会抛错,调用方应 catch 后降级为手填。
 *
 * 注意:gemini 的 key 在 URL query param,本函数内部使用,不返回给前端、不打日志。
 */
export async function fetchUpstreamModels(opts: {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
}): Promise<UpstreamModel[]> {
  const { protocol, baseUrl, apiKey, headers } = opts;
  if (!apiKey) throw new Error("缺少 API Key");
  if (!baseUrl) throw new Error("缺少接口地址");

  const base = baseUrl.replace(/\/+$/, "");

  switch (protocol) {
    case "anthropic":
      return fetchAnthropicModels(base, apiKey, headers);
    case "gemini":
      return fetchGeminiModels(base, apiKey, headers);
    case "openai":
    case "openai-compatible":
    default:
      return fetchOpenAIModels(base, apiKey, headers);
  }
}

/** OpenAI 兼容:GET {base}/models,Authorization: Bearer,响应 {data:[{id}]}。 */
async function fetchOpenAIModels(
  base: string,
  apiKey: string,
  headers?: Record<string, string>,
): Promise<UpstreamModel[]> {
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...headers },
    // 模型列表拉取给一个合理上限,避免异常上游拖住请求。
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`上游返回 ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: { id?: string }[] };
  const ids = Array.isArray(json.data)
    ? json.data.map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return ids.map((id) => ({ id }));
}

/** Anthropic:GET {base}/models,x-api-key + anthropic-version,响应 {data:[{id}]}。 */
async function fetchAnthropicModels(
  base: string,
  apiKey: string,
  headers?: Record<string, string>,
): Promise<UpstreamModel[]> {
  const res = await fetch(`${base}/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`上游返回 ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data?: { id?: string }[] };
  const ids = Array.isArray(json.data)
    ? json.data.map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return ids.map((id) => ({ id }));
}

/** Gemini:GET {base}/models?key={apiKey},响应 {models:[{name:"models/xxx"}]},去前缀。 */
async function fetchGeminiModels(
  base: string,
  apiKey: string,
  headers?: Record<string, string>,
): Promise<UpstreamModel[]> {
  const res = await fetch(`${base}/models?key=${encodeURIComponent(apiKey)}`, {
    headers,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`上游返回 ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { models?: { name?: string }[] };
  const ids = Array.isArray(json.models)
    ? json.models
        .map((m) => m?.name?.replace(/^models\//, ""))
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return ids.map((id) => ({ id }));
}
