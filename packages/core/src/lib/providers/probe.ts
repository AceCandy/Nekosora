/**
 * 主动探测 -- 配置期对上游 provider 的 key 有效性验证与模型列表拉取。
 *
 * 与运行期的被动熔断(circuit-breaker)互补:被动机制只在真实请求失败时生效,
 * 这里提供"配完即测"的主动能力,避免 key/baseUrl/模型名 配错后要等到真实调用才发现。
 *
 * probeProviderKey 按是否传入 upstreamModelName 区分两个职责(对齐 AQBot 的
 * validate_key 与 test_model 分离):
 *   - 不传模型名 -> 验证 key 有效性:对 chat 端点发空 body POST(对齐 AQBot anthropic
 *     的 /messages 空 body 思路)。chat 端点一定校验 key(不像 /models 很多中转站公开),
 *     valid key -> 400(缺字段),invalid -> 401/403。空 body 不产生生成、不计费、不依赖
 *     具体模型,避免聚合站 "/models 公开不校验 key" 或 "列表第一个是 voice/image" 误判。
 *   - 传入模型名 -> 测该具体模型可用性:发极小生成请求,验证模型 + key + 协议构建全链路。
 *
 * fetchUpstreamModels -- 直接 fetch 上游 /models 拉取真实模型名,防手填出错。
 *
 * 协议差异(key 探测的 URL/鉴权头):
 *   - openai/openai-compatible: Authorization: Bearer,POST {base}/chat/completions
 *   - anthropic:    x-api-key + anthropic-version,POST {base}/messages
 *   - gemini:       key 在 query param,GET {base}/models?key=...(chat 端点要带 model 路径,退回 /models)
 */
import { generateText, streamText } from "ai";
import { buildLanguageModelWithKey } from "@/lib/providers/registry";
import { isKeyAuthError } from "@/lib/stream";
import { redactErrorMessage } from "@/lib/redaction";
import type { ResolvedRoute } from "@/lib/providers/types";
import {
  createProviderFetch,
  createProviderTimeoutScope,
  resolveProviderTimeouts,
  type ProviderTimeoutConfig,
} from "@/lib/providers/timeouts";
import type { ProviderProtocol, RouteApiFormat } from "@/db/types";

/** 探测结果。ok=false 时 errorKind 区分认证/网络/未知,供 UI 分类展示。 */
export interface ProbeResult {
  ok: boolean;
  /** 成功时的往返延迟(ms)。 */
  latencyMs?: number;
  /** 失败原因(面向用户的简短描述)。 */
  error?: string;
  /** 失败分类,便于 UI 给出针对性提示。 */
  errorKind?: "auth" | "network" | "unknown";
  mode?: "non-stream" | "stream";
  nonStreamError?: string;
}

/** 拉取到的上游模型条目(统一为 OpenAI 风格的 id)。 */
export interface UpstreamModel {
  id: string;
}

/** /models 探测与列表拉取的超时上限,避免异常上游拖住请求。 */
const PROBE_TIMEOUT_MS = 15000;

/**
 * 按协议构建 GET /models 的 URL 与鉴权头。
 * gemini 的 key 探测(buildKeyAuthRequest 的 gemini 分支)与列表拉取(fetchUpstreamModels)
 * 共用,保证鉴权头逻辑单一来源。
 */
function buildModelsRequest(
  protocol: ProviderProtocol,
  base: string,
  apiKey: string,
  headers?: Record<string, string>,
): { url: string; init: RequestInit } {
  const merged = headers ?? {};
  const common: RequestInit = {
    cache: "no-store",
  };
  switch (protocol) {
    case "anthropic":
      return {
        url: `${base}/models`,
        init: {
          ...common,
          headers: {
            "x-api-key": apiKey,
            // 部分上游(火山 Ark 的 anthropic 兼容端点)/models 仅认 Bearer,
            // /messages 才认 x-api-key -- 同一 key 两端点鉴权头不一致。
            // 同时携带两种头兼容这类混搭上游;标准 anthropic 服务端忽略多余的 Authorization。
            Authorization: `Bearer ${apiKey}`,
            "anthropic-version": "2023-06-01",
            ...merged,
          },
        },
      };
    case "gemini":
      // gemini 的 key 在 URL query param,仅在本函数内部使用,不外泄到前端、不打日志。
      return {
        url: `${base}/models?key=${encodeURIComponent(apiKey)}`,
        init: { ...common, headers: merged },
      };
    case "openai":
    case "openai-compatible":
    default:
      return {
        url: `${base}/models`,
        init: {
          ...common,
          headers: { ...(apiKey && { Authorization: `Bearer ${apiKey}` }), ...merged },
        },
      };
  }
}

/**
 * 按协议构造 key 有效性探测请求:对 chat 端点发空 body POST(不产生生成、不计费)。
 * chat 端点一定校验 key(不像 /models 可能公开),valid key -> 400(缺字段),invalid -> 401/403。
 * gemini 的 chat 端点要带 model 路径,空 body 不便,退回 GET /models。
 */
function buildKeyAuthRequest(
  protocol: ProviderProtocol,
  base: string,
  apiKey: string,
  headers?: Record<string, string>,
): { url: string; init: RequestInit } {
  const merged = headers ?? {};
  const common: RequestInit = {
    cache: "no-store",
  };
  switch (protocol) {
    case "anthropic":
      return {
        url: `${base}/messages`,
        init: {
          ...common,
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            // 火山 Ark 等混搭上游 /messages 认 x-api-key,同时携带 Bearer 兼容。
            Authorization: `Bearer ${apiKey}`,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            ...merged,
          },
          body: "{}",
        },
      };
    case "gemini":
      // gemini chat 端点(/models/{model}:generateContent)要带 model 路径,
      // 空 body 不便;退回 GET /models 校验 key(gemini key 在 query param)。
      return buildModelsRequest(protocol, base, apiKey, headers);
    case "openai":
    case "openai-compatible":
    default:
      return {
        url: `${base}/chat/completions`,
        init: {
          ...common,
          method: "POST",
          headers: {
            ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
            "content-type": "application/json",
            ...merged,
          },
          body: "{}",
        },
      };
  }
}

/**
 * 探测上游:不传 upstreamModelName -> 验证 key 有效性(POST chat 空 body);
 * 传 upstreamModelName -> 测该具体模型可用性(极小生成请求)。
 */
export async function probeProviderKey(opts: {
  protocol: ProviderProtocol;
  apiFormat?: RouteApiFormat;
  baseUrl: string;
  apiKey: string;
  /** 传入则测试该具体模型可用性;缺省只验证 key + baseUrl + 协议鉴权。 */
  upstreamModelName?: string;
  headers?: Record<string, string>;
} & ProviderTimeoutConfig): Promise<ProbeResult> {
  const { baseUrl, upstreamModelName } = opts;
  if (!baseUrl) {
    return { ok: false, error: "缺少接口地址", errorKind: "unknown" };
  }
  if (upstreamModelName) {
    return probeModelAvailability({ ...opts, upstreamModelName });
  }
  return probeKeyAuth(opts);
}

/**
 * 测具体模型可用性:用极小生成请求验证 模型 + key + baseUrl + 协议构建 全链路。
 * 对应 AQBot 的 test_model(需要具体 modelId,返回延迟)。
 */
async function probeModelAvailability(opts: {
  protocol: ProviderProtocol;
  apiFormat?: RouteApiFormat;
  baseUrl: string;
  apiKey: string;
  upstreamModelName: string;
  headers?: Record<string, string>;
} & ProviderTimeoutConfig): Promise<ProbeResult> {
  const { protocol, apiFormat, baseUrl, apiKey, headers, upstreamModelName } = opts;
  const timeouts = resolveProviderTimeouts(opts);
  const timeoutScope = createProviderTimeoutScope(
    undefined,
    Math.min(timeouts.readTimeoutMs, PROBE_TIMEOUT_MS),
    "read",
  );
  const startedAt = Date.now();
  const secrets = [apiKey, ...Object.values(headers ?? {})];
  try {
    // 构造一次性 ResolvedRoute(mock),复用 registry 的协议构建逻辑。
    const route: ResolvedRoute = {
      modelName: "__probe__",
      upstreamModelName,
      protocol,
      apiFormat,
      provider: {
        id: "__probe__",
        name: "__probe__",
        protocol,
        baseUrl,
        apiKey,
        keys: [{ key: apiKey, weight: 1 }],
        connectTimeoutMs: timeouts.connectTimeoutMs,
        readTimeoutMs: timeouts.readTimeoutMs,
        streamIdleTimeoutMs: timeouts.streamIdleTimeoutMs,
        headers,
      },
      priority: 0,
      weight: 1,
      source: "global",
      routeId: "__probe__",
    };
    let model: ReturnType<typeof buildLanguageModelWithKey>;
    try {
      model = buildLanguageModelWithKey(
        route,
        apiKey,
        undefined,
        undefined,
        headers?.["user-agent"],
      );
    } catch (err) {
      const errorKind: ProbeResult["errorKind"] = isKeyAuthError(err)
        ? "auth"
        : isNetworkError(err)
          ? "network"
          : "unknown";
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: redactErrorMessage(err, secrets),
        errorKind,
      };
    }
    const providerOptions = apiFormat === "openai-responses"
      ? { openai: { store: false } }
      : undefined;
    try {
      await generateText({
        model,
        prompt: "hi",
        maxOutputTokens: 1,
        maxRetries: 0,
        providerOptions,
        abortSignal: timeoutScope.signal,
      });
      return { ok: true, latencyMs: Date.now() - startedAt, mode: "non-stream" };
    } catch (err) {
      const failure = preserveProbeTimeoutReason(err, timeoutScope.signal);
      const msg = redactErrorMessage(failure, secrets);
      const errorKind: ProbeResult["errorKind"] = isKeyAuthError(failure)
        ? "auth"
        : isNetworkError(failure)
          ? "network"
          : "unknown";
      if (errorKind === "auth" || errorKind === "network") {
        return { ok: false, latencyMs: Date.now() - startedAt, error: msg, errorKind };
      }
      try {
        let streamError: unknown;
        const result = streamText({
          model,
          prompt: "hi",
          maxOutputTokens: 8,
          maxRetries: 0,
          providerOptions,
          abortSignal: timeoutScope.signal,
          timeout: { chunkMs: timeouts.streamIdleTimeoutMs },
        });
        await result.consumeStream({ onError: (error) => { streamError = error; } });
        if (streamError) throw streamError;
        return {
          ok: true,
          latencyMs: Date.now() - startedAt,
          mode: "stream",
          nonStreamError: msg,
        };
      } catch (streamErr) {
        const failure = preserveProbeTimeoutReason(streamErr, timeoutScope.signal);
        const streamMsg = redactErrorMessage(failure, secrets);
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: `非流式: ${msg}; 流式: ${streamMsg}`,
          errorKind: isKeyAuthError(failure)
            ? "auth"
            : isNetworkError(failure)
              ? "network"
              : "unknown",
        };
      }
    }
  } finally {
    timeoutScope.dispose();
  }
}

/**
 * 验证 key 有效性:对 chat 端点发空 body POST(不产生生成、不计费),按 HTTP status 判定。
 *
 * chat 端点一定校验 key(不像 /models 很多中转站公开),valid key -> 400(缺 messages 等字段),
 * invalid -> 401/403。空 body 不指定 model、不产生生成,避免聚合站 voice/image 模型计费误判。
 * gemini 退回 GET /models(见 buildKeyAuthRequest)。
 */
async function probeKeyAuth(opts: {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
} & ProviderTimeoutConfig): Promise<ProbeResult> {
  const { protocol, baseUrl, apiKey, headers } = opts;
  const base = baseUrl.replace(/\/+$/, "");
  const { url, init } = buildKeyAuthRequest(protocol, base, apiKey, headers);
  const timeouts = resolveProviderTimeouts(opts);
  const timeoutScope = createProviderTimeoutScope(
    undefined,
    Math.min(timeouts.readTimeoutMs, PROBE_TIMEOUT_MS),
    "read",
  );
  const providerFetch = createProviderFetch({
    connectTimeoutMs: Math.min(timeouts.connectTimeoutMs, PROBE_TIMEOUT_MS),
  });
  const startedAt = Date.now();
  try {
    const res = await providerFetch(url, { ...init, signal: timeoutScope.signal });
    const latencyMs = Date.now() - startedAt;
    const status = res.status;
    if (status === 401 || status === 403) {
      const body = await readProbeResponseText(res, timeoutScope.signal);
      // 伪 401/403:opencode 等先校验 model 的上游,空 body 缺 model 直接返 401 + ModelError,
      // 压根没到 key 校验。判 unknown(网络层仍通),避免误导成"密钥错";要验 key 需带 model 深度检测。
      if (/modelerror|not supported|unsupported model|model.{0,10}not/i.test(body)) {
        return {
          ok: false,
          latencyMs,
          error: `上游要求指定 model(HTTP ${status}),空 body 无法验证 key`,
          errorKind: "unknown",
        };
      }
      // 鉴权失败:key 无效或无权限。
      return {
        ok: false,
        latencyMs,
        error: `密钥无效或无权限 (HTTP ${status})`,
        errorKind: "auth",
      };
    }
    if (status >= 500) {
      // 上游服务异常:能连上、鉴权未拒,但上游不可用。不归 auth,避免误导成"密钥错"。
      return {
        ok: false,
        latencyMs,
        error: `上游服务异常 (HTTP ${status} ${res.statusText})`,
        errorKind: "unknown",
      };
    }
    // gemini 退回 GET /models:官方对无效 key 返 400(非 401/403),body 含 "API key not valid"。
    // 通用判定把 400 当"key 有效",此处单独解析 body,命中 key 无效字样判 auth 失败。
    if (protocol === "gemini") {
      const body = await readProbeResponseText(res, timeoutScope.signal);
      if (
        /api key not valid|api[_-]?key.{0,20}invalid|invalid.{0,20}api[_-]?key|api_key_invalid|permission_denied/i.test(
          body,
        )
      ) {
        return {
          ok: false,
          latencyMs,
          error: `密钥无效或无权限 (HTTP ${status})`,
          errorKind: "auth",
        };
      }
    }
    // 400(valid key 缺 messages 等字段)/2xx/404 等:chat 端点已校验过 key,视为 key 有效 + 网络通。
    return { ok: true, latencyMs };
  } catch (err) {
    const failure = preserveProbeTimeoutReason(err, timeoutScope.signal);
    const latencyMs = Date.now() - startedAt;
    const errorKind: ProbeResult["errorKind"] = isNetworkError(failure)
      ? "network"
      : "unknown";
    const msg = redactErrorMessage(failure, [apiKey, ...Object.values(headers ?? {})]);
    return { ok: false, latencyMs, error: msg, errorKind };
  } finally {
    timeoutScope.dispose();
  }
}

async function readProbeResponseText(response: Response, signal: AbortSignal): Promise<string> {
  if (typeof response.text !== "function") return "";
  try {
    return await response.text();
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    return "";
  }
}

function preserveProbeTimeoutReason(error: unknown, signal: AbortSignal): unknown {
  return signal.aborted ? (signal.reason ?? error) : error;
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
 * 自定义上游若 /models 返回错误状态会抛错,调用方应 catch 后降级为手填。
 */
export async function fetchUpstreamModels(opts: {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
} & ProviderTimeoutConfig): Promise<UpstreamModel[]> {
  const { protocol, baseUrl, apiKey, headers } = opts;
  if (!baseUrl) throw new Error("缺少接口地址");

  const base = baseUrl.replace(/\/+$/, "");
  const { url, init } = buildModelsRequest(protocol, base, apiKey, headers);
  const timeouts = resolveProviderTimeouts(opts);
  const timeoutScope = createProviderTimeoutScope(
    undefined,
    Math.min(timeouts.readTimeoutMs, PROBE_TIMEOUT_MS),
    "read",
  );
  const providerFetch = createProviderFetch({
    connectTimeoutMs: Math.min(timeouts.connectTimeoutMs, PROBE_TIMEOUT_MS),
  });
  try {
    const res = await providerFetch(url, { ...init, signal: timeoutScope.signal });
    if (!res.ok) {
      throw new Error(`上游返回 ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    // gemini 的列表结构与其他协议不同,单独解析;openai/openai-compatible/anthropic
    // 都是 {data:[{id}]} 结构,共用 parseDataModels。
    if (protocol === "gemini") {
      return parseGeminiModels(json);
    }
    return parseDataModels(json);
  } catch (error) {
    const failure = preserveProbeTimeoutReason(error, timeoutScope.signal);
    throw new Error(
      redactErrorMessage(failure, [apiKey, ...Object.values(headers ?? {})], "拉取上游模型失败"),
    );
  } finally {
    timeoutScope.dispose();
  }
}

/** OpenAI 兼容/Anthropic:响应 {data:[{id}]}。data 缺失时返回空列表(不抛错)。 */
function parseDataModels(json: unknown): UpstreamModel[] {
  const data = (json as { data?: { id?: string }[] | null })?.data;
  const ids = Array.isArray(data)
    ? data
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return ids.map((id) => ({ id }));
}

/** Gemini:响应 {models:[{name:"models/xxx"}]},去前缀。models 缺失时返回空列表。 */
function parseGeminiModels(json: unknown): UpstreamModel[] {
  const models = (json as { models?: { name?: string }[] | null })?.models;
  const ids = Array.isArray(models)
    ? models
        .map((m) => m?.name?.replace(/^models\//, ""))
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return ids.map((id) => ({ id }));
}
