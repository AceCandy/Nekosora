import { NextResponse, type NextRequest } from "next/server";
import { translateError, DEFAULT_LOCALE } from "@/lib/i18n";

/**
 * 全站错误码体系 —— 统一 API 错误响应契约。
 *
 * 契约:所有 API 路由(尤其是 /v1/* 网关)返回错误时,body 格式为:
 *   {
 *     error: {
 *       code:    string,   // 稳定的机读错误码(点分命名空间),如 "auth.invalid_key"
 *       message: string,   // 人类可读信息(默认中文,I-06 后由 i18n 提供)
 *       type:    string,   // OpenAI 风格错误类型,便于 SDK 分类
 *       details?: unknown  // 可选的额外上下文(字段级错误、上游响应等)
 *     }
 *   }
 *
 * HTTP status 由错误码决定,不由调用方随意设置,保证一致性。
 *
 * 设计原则:
 *   1. code 是稳定契约,前端/客户端据此分支处理(永不改变字符串)。
 *   2. message 仅作展示,I-06 接入 i18n 后按 Accept-Language 渲染。
 *   3. type 对齐 OpenAI 四类:invalid_request_error / authentication_error /
 *      rate_limit_exceeded / server_error / not_found_error。
 */

/** OpenAI 风格错误类型(对齐官方 SDK 分类)。 */
export type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_denied_error"
  | "not_found_error"
  | "rate_limit_exceeded"
  | "server_error";

/** 点分错误码(机读)。新增错误时在此枚举登记,确保唯一。 */
export const ErrorCode = {
  // --- 鉴权 (auth.*) ---
  AUTH_MISSING_KEY: "auth.missing_key",
  AUTH_INVALID_KEY: "auth.invalid_key",
  AUTH_KEY_DISABLED: "auth.key_disabled",

  // --- 路由 (routing.*) ---
  ROUTING_MODEL_NOT_FOUND: "routing.model_not_found",
  ROUTING_MODEL_NOT_AVAILABLE: "routing.model_not_available",
  ROUTING_MODEL_NOT_BOUND: "routing.model_not_bound",
  ROUTING_NO_ROUTE: "routing.no_route",
  ROUTING_CAPABILITY_NOT_SUPPORTED: "routing.capability_not_supported",

  // --- 请求校验 (request.*) ---
  REQUEST_INVALID_JSON: "request.invalid_json",
  REQUEST_MISSING_FIELD: "request.missing_field",
  REQUEST_PAYLOAD_TOO_LARGE: "request.payload_too_large",

  // --- 上游/生成 (gateway.*) ---
  GATEWAY_UPSTREAM_ERROR: "gateway.upstream_error",
  GATEWAY_GENERATION_FAILED: "gateway.generation_failed",
  GATEWAY_ALL_ROUTES_FAILED: "gateway.all_routes_failed",
  GATEWAY_TIMEOUT: "gateway.timeout",

  // --- 多模态 (media.*) ---
  MEDIA_IMAGE_GEN_FAILED: "media.image_gen_failed",
  MEDIA_TTS_FAILED: "media.tts_failed",
  MEDIA_STT_FAILED: "media.stt_failed",

  // --- 通用 (server.*) ---
  SERVER_INTERNAL: "server.internal",
  SERVER_SERVICE_UNAVAILABLE: "server.service_unavailable",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 错误码元数据:HTTP 状态 + OpenAI 类型 + i18n key。 */
interface ErrorMeta {
  status: number;
  type: ErrorType;
  /** i18n 字典 key(对应 src/lib/i18n/errors.*.ts 的点分码)。 */
  i18nKey: string;
}

export const ERROR_META: Record<ErrorCodeValue, ErrorMeta> = {
  // auth.*
  [ErrorCode.AUTH_MISSING_KEY]: {
    status: 401,
    type: "authentication_error",
    i18nKey: "errors.auth_missing_key",
  },
  [ErrorCode.AUTH_INVALID_KEY]: {
    status: 401,
    type: "authentication_error",
    i18nKey: "errors.auth_invalid_key",
  },
  [ErrorCode.AUTH_KEY_DISABLED]: {
    status: 401,
    type: "authentication_error",
    i18nKey: "errors.auth_key_disabled",
  },

  // routing.*
  [ErrorCode.ROUTING_MODEL_NOT_FOUND]: {
    status: 404,
    type: "not_found_error",
    i18nKey: "errors.routing_model_not_found",
  },
  [ErrorCode.ROUTING_MODEL_NOT_AVAILABLE]: {
    status: 404,
    type: "not_found_error",
    i18nKey: "errors.routing_model_not_available",
  },
  [ErrorCode.ROUTING_MODEL_NOT_BOUND]: {
    status: 403,
    type: "permission_denied_error",
    i18nKey: "errors.routing_model_not_bound",
  },
  [ErrorCode.ROUTING_NO_ROUTE]: {
    status: 503,
    type: "server_error",
    i18nKey: "errors.routing_no_route",
  },
  [ErrorCode.ROUTING_CAPABILITY_NOT_SUPPORTED]: {
    status: 400,
    type: "invalid_request_error",
    i18nKey: "errors.routing_capability_not_supported",
  },

  // request.*
  [ErrorCode.REQUEST_INVALID_JSON]: {
    status: 400,
    type: "invalid_request_error",
    i18nKey: "errors.request_invalid_json",
  },
  [ErrorCode.REQUEST_MISSING_FIELD]: {
    status: 400,
    type: "invalid_request_error",
    i18nKey: "errors.request_missing_field",
  },
  [ErrorCode.REQUEST_PAYLOAD_TOO_LARGE]: {
    status: 413,
    type: "invalid_request_error",
    i18nKey: "errors.request_payload_too_large",
  },

  // gateway.*
  [ErrorCode.GATEWAY_UPSTREAM_ERROR]: {
    status: 502,
    type: "server_error",
    i18nKey: "errors.gateway_upstream_error",
  },
  [ErrorCode.GATEWAY_GENERATION_FAILED]: {
    status: 500,
    type: "server_error",
    i18nKey: "errors.gateway_generation_failed",
  },
  [ErrorCode.GATEWAY_ALL_ROUTES_FAILED]: {
    status: 503,
    type: "server_error",
    i18nKey: "errors.gateway_all_routes_failed",
  },
  [ErrorCode.GATEWAY_TIMEOUT]: {
    status: 504,
    type: "server_error",
    i18nKey: "errors.gateway_timeout",
  },

  // media.*
  [ErrorCode.MEDIA_IMAGE_GEN_FAILED]: {
    status: 502,
    type: "server_error",
    i18nKey: "errors.media_image_gen_failed",
  },
  [ErrorCode.MEDIA_TTS_FAILED]: {
    status: 502,
    type: "server_error",
    i18nKey: "errors.media_tts_failed",
  },
  [ErrorCode.MEDIA_STT_FAILED]: {
    status: 502,
    type: "server_error",
    i18nKey: "errors.media_stt_failed",
  },

  // server.*
  [ErrorCode.SERVER_INTERNAL]: {
    status: 500,
    type: "server_error",
    i18nKey: "errors.server_internal",
  },
  [ErrorCode.SERVER_SERVICE_UNAVAILABLE]: {
    status: 503,
    type: "server_error",
    i18nKey: "errors.server_service_unavailable",
  },
};

/** 标准化错误响应 body 结构。 */
export interface ErrorResponseBody {
  error: {
    code: ErrorCodeValue;
    message: string;
    type: ErrorType;
    details?: unknown;
  };
}

/**
 * 构造错误响应 body 对象(不带 HTTP status)。
 * 供流式场景(SSE 帧)或需要自定义包装的场景使用。
 *
 * @param code 错误码(枚举值)
 * @param details 可选的额外上下文
 * @param messageOverride 覆盖默认文案(I-06 后传 i18n 解析结果)
 */
export function errorResponse(
  code: ErrorCodeValue,
  details?: unknown,
  messageOverride?: string,
): ErrorResponseBody {
  const meta = ERROR_META[code];
  // message 优先级:调用方 override > i18n 字典(默认 zh-CN)> 错误码本身。
  const message = messageOverride ?? resolveDefaultMessage(code);
  return {
    error: {
      code,
      message,
      type: meta.type,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * 解析错误码的默认中文文案(从 i18n 字典查,zh-CN locale)。
 * 供 errorResponse 在无 override 时 fallback。单一文案来源,消除冗余。
 */
function resolveDefaultMessage(code: ErrorCodeValue): string {
  return translateError(code, DEFAULT_LOCALE);
}

/**
 * 构造 NextResponse 错误响应(带正确 HTTP status)。
 * /v1/* 路由统一用此函数返回错误。
 *
 * @param code 错误码
 * @param details 可选的额外上下文
 * @param messageOverride 覆盖默认文案(I-06 后传 i18n 解析结果)
 */
export function apiError(
  code: ErrorCodeValue,
  details?: unknown,
  messageOverride?: string,
) {
  const meta = ERROR_META[code];
  return NextResponse.json(
    errorResponse(code, details, messageOverride),
    { status: meta.status },
  );
}

/**
 * 由 RoutingError 的 code 映射到全局 ErrorCode。
 * routing.ts 抛出的 RoutingError.code 是历史短码(如 "model_not_found"),
 * 这里转成新体系的点分码。
 */
const ROUTING_CODE_MAP: Record<string, ErrorCodeValue> = {
  model_not_found: ErrorCode.ROUTING_MODEL_NOT_FOUND,
  model_not_available: ErrorCode.ROUTING_MODEL_NOT_AVAILABLE,
  model_not_bound: ErrorCode.ROUTING_MODEL_NOT_BOUND,
  no_route: ErrorCode.ROUTING_NO_ROUTE,
  capability_not_supported: ErrorCode.ROUTING_CAPABILITY_NOT_SUPPORTED,
  routing_error: ErrorCode.SERVER_INTERNAL,
};

export function routingCodeToErrorCode(routingCode: string): ErrorCodeValue {
  return ROUTING_CODE_MAP[routingCode] ?? ErrorCode.SERVER_INTERNAL;
}

/**
 * 构造本地化的错误响应:按请求的 Accept-Language 头解析 locale,
 * 返回对应语言文案的 NextResponse。
 *
 * I-06 引入。网关 /v1/* 路由优先用此函数(国际化面向全球开发者),
 * 纯内部端点(如 /api/chat session 鉴权)可用 apiError(默认中文)。
 *
 * @param code 错误码
 * @param req NextRequest(用于读 Accept-Language 头)
 * @param details 可选的额外上下文
 */
export async function apiErrorLocalized(
  code: ErrorCodeValue,
  req: NextRequest,
  details?: unknown,
) {
  const { resolveLocale } = await import("@/lib/i18n");
  const locale = resolveLocale(req.headers.get("accept-language"));
  const message = translateError(code, locale);
  return apiError(code, details, message);
}
