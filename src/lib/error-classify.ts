/**
 * 错误分类 —— 把一次失败请求的 errorCode / httpStatus / errorMessage
 * 映射成两层分类,供 ops_error_logs.errorPhase + 前端粗分类 i18n 文案使用。
 *
 *   - errorPhase:请求生命周期阶段(routing/upstream/network/internal/auth/request),
 *     对齐 db/types.ts 的 ErrorPhase,直接落 ops_error_logs.error_phase 列。
 *   - category:用户友好的粗分类(前端 i18n key,对应 messages/*.json 的
 *     admin.usage.errors.categories.*),不落库,由前端查询时按需派生。
 *
 * 设计为单一来源:stream.ts / gateway route.ts 失败落库前都调 classifyError。
 * 优先级:已知 errorCode 精确匹配 > httpStatus 推断 > errorMessage 关键字 > 兜底。
 */
import { ErrorCode } from "@/lib/errors";
import type { ErrorPhase } from "@/db/types";

/** 错误粗分类(前端 i18n key 后缀)。 */
export type ErrorCategory =
  | "auth"
  | "service_unavailable"
  | "upstream"
  | "internal"
  | "rate_limit"
  | "quota"
  | "invalid_request"
  | "other";

export interface ClassifiedError {
  phase: ErrorPhase;
  category: ErrorCategory;
}

export interface ClassifyErrorInput {
  /** 错误码(短码如 generation_failed,或点分码如 auth.invalid_key)。 */
  errorCode?: string;
  /** HTTP 状态码(区别于枚举 status)。 */
  httpStatus?: number;
  /** 错误信息(脱敏后;仅用于 network/timeout 关键字识别)。 */
  errorMessage?: string;
}

/**
 * 已知 errorCode → { phase, category } 精确映射。
 * 同时收录短码(stream.ts 内部用)与点分码(ErrorCode 枚举),保证两种写法都能命中。
 */
const ERROR_CODE_MAP: Record<string, ClassifiedError> = {
  // —— 鉴权失败 ——
  [ErrorCode.AUTH_MISSING_KEY]: { phase: "auth", category: "auth" },
  [ErrorCode.AUTH_INVALID_KEY]: { phase: "auth", category: "auth" },
  [ErrorCode.AUTH_KEY_DISABLED]: { phase: "auth", category: "auth" },

  // —— 模型不存在 / 未绑定 / 不可用(用户请求了不合法的模型,归 request) ——
  [ErrorCode.ROUTING_MODEL_NOT_FOUND]: { phase: "request", category: "invalid_request" },
  [ErrorCode.ROUTING_MODEL_NOT_BOUND]: { phase: "request", category: "invalid_request" },
  [ErrorCode.ROUTING_MODEL_NOT_AVAILABLE]: { phase: "request", category: "invalid_request" },
  // 历史短码(RoutingError.code)同名映射
  model_not_found: { phase: "request", category: "invalid_request" },
  model_not_bound: { phase: "request", category: "invalid_request" },
  model_not_available: { phase: "request", category: "invalid_request" },

  // —— 无可用路由 / 路由错误 / 能力不支持(路由层问题,service_unavailable) ——
  [ErrorCode.ROUTING_NO_ROUTE]: { phase: "routing", category: "service_unavailable" },
  [ErrorCode.ROUTING_CAPABILITY_NOT_SUPPORTED]: { phase: "routing", category: "service_unavailable" },
  // SERVER_INTERNAL 是 routing_error 短码的兜底映射目标,但作为 routing_error 短码本身归 routing
  no_route: { phase: "routing", category: "service_unavailable" },
  routing_error: { phase: "routing", category: "service_unavailable" },
  capability_not_supported: { phase: "routing", category: "service_unavailable" },

  // —— 请求体校验 ——
  [ErrorCode.REQUEST_INVALID_JSON]: { phase: "request", category: "invalid_request" },
  [ErrorCode.REQUEST_MISSING_FIELD]: { phase: "request", category: "invalid_request" },

  // —— 生成 / 上游失败(无更多线索时归 upstream) ——
  [ErrorCode.GATEWAY_GENERATION_FAILED]: { phase: "upstream", category: "upstream" },
  [ErrorCode.GATEWAY_UPSTREAM_ERROR]: { phase: "upstream", category: "upstream" },
  [ErrorCode.GATEWAY_ALL_ROUTES_FAILED]: { phase: "upstream", category: "service_unavailable" },
  generation_failed: { phase: "upstream", category: "upstream" },
  // stream.ts 按真实上游 statusCode 提取的细码(区分限流/鉴权/上游/网络),与 generation_failed 兜底互补。
  rate_limited: { phase: "request", category: "rate_limit" },
  auth_error: { phase: "auth", category: "auth" },
  upstream_error: { phase: "upstream", category: "upstream" },
  network_error: { phase: "network", category: "upstream" },

  // —— 超时(网络层) ——
  [ErrorCode.GATEWAY_TIMEOUT]: { phase: "network", category: "upstream" },

  // —— 多模态生成失败 ——
  [ErrorCode.MEDIA_IMAGE_GEN_FAILED]: { phase: "upstream", category: "upstream" },
  [ErrorCode.MEDIA_TTS_FAILED]: { phase: "upstream", category: "upstream" },
  [ErrorCode.MEDIA_STT_FAILED]: { phase: "upstream", category: "upstream" },

  // —— 服务端内部 ——
  [ErrorCode.SERVER_INTERNAL]: { phase: "internal", category: "internal" },
  [ErrorCode.SERVER_SERVICE_UNAVAILABLE]: { phase: "internal", category: "service_unavailable" },
};

/** network/超时 关键字识别(errorMessage 中命中即归 network)。stream.ts 复用此正则判网络错误。 */
export const NETWORK_KEYWORDS =
  /timeout|timed out|etimedout|econnreset|enetunreach|ehostunreach|econnrefused|socket hang up|network error|connect\b/i;

/** 把一次失败的可用线索分类成 phase + category。 */
export function classifyError(input: ClassifyErrorInput): ClassifiedError {
  const { errorCode, httpStatus, errorMessage } = input;

  // 1. 已知 errorCode 精确匹配(最高优先级,最稳定)
  if (errorCode && ERROR_CODE_MAP[errorCode]) {
    return ERROR_CODE_MAP[errorCode];
  }

  // 2. httpStatus 推断
  if (httpStatus !== undefined) {
    if (httpStatus === 401 || httpStatus === 403) {
      return { phase: "auth", category: "auth" };
    }
    if (httpStatus === 429) {
      return { phase: "request", category: "rate_limit" };
    }
    if (httpStatus === 402) {
      return { phase: "request", category: "quota" };
    }
    if (httpStatus >= 400 && httpStatus < 500) {
      return { phase: "request", category: "invalid_request" };
    }
    if (httpStatus >= 500) {
      return { phase: "upstream", category: "upstream" };
    }
  }

  // 3. errorMessage 关键字(超时/网络)
  if (errorMessage && NETWORK_KEYWORDS.test(errorMessage)) {
    return { phase: "network", category: "upstream" };
  }

  // 4. 兜底
  return { phase: "internal", category: "other" };
}
