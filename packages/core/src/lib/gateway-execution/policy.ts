import { classifyError, NETWORK_KEYWORDS } from "@/lib/error-classify";
import { ErrorCode } from "@/lib/errors";
import { redactSensitiveText } from "@/lib/redaction";
import type { ResolvedRoute } from "@/lib/providers/types";
import { isProviderTimeoutError } from "@/lib/providers/timeouts";
import type { SafeGatewayError } from "./types";

const TOOL_REFERENCE = /\b(?:tools?|tool[_ -]?choice|function[_ -]?calls?)\b/i;
const TOOL_UNSUPPORTED = /(?:unsupported|not\s+supported|does\s+not\s+support|doesn't\s+support|not\s+allowed|unrecognized|unknown\s+(?:field|parameter))/i;
const STREAM_OPTIONS_REFERENCE = /\bstream_options\b/i;

function stringifyErrorPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value).slice(0, 4096);
  } catch {
    return "";
  }
}

/** 仅识别明确的工具参数兼容性拒绝，不把普通 4xx 或工具执行错误当成路由能力。 */
export function isToolUnsupportedError(error: unknown): boolean {
  const { statusCode, haystack } = compatibilityError(error);
  return (statusCode === 400 || statusCode === 422)
    && TOOL_REFERENCE.test(haystack)
    && TOOL_UNSUPPORTED.test(haystack);
}

/** 仅识别明确拒绝 stream_options 的 400，供 compatible Chat 自动降级。 */
export function isStreamOptionsUnsupportedError(error: unknown): boolean {
  const { statusCode, haystack } = compatibilityError(error);
  return statusCode === 400
    && STREAM_OPTIONS_REFERENCE.test(haystack)
    && TOOL_UNSUPPORTED.test(haystack);
}

function compatibilityError(error: unknown): { statusCode: unknown; haystack: string } {
  const nested = (error as { lastError?: unknown } | null)?.lastError;
  const source = (nested ?? error) as {
    statusCode?: unknown;
    message?: unknown;
    responseBody?: unknown;
    data?: unknown;
  };
  const statusCode = source?.statusCode;
  const rawMessage = source instanceof Error ? source.message : stringifyErrorPart(source);
  const haystack = [
    rawMessage,
    stringifyErrorPart(source?.message),
    stringifyErrorPart(source?.responseBody),
    stringifyErrorPart(source?.data),
  ].join(" ").slice(0, 12_000);
  return { statusCode, haystack };
}

export function isAbortError(error: unknown): boolean {
  if (isProviderTimeoutError(error)) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /this operation was aborted|aborted/i.test(message);
}

export function isFailoverableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !/model_not_found|invalid_request|context.*length/i.test(message);
}

export function isKeyAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid_api_key|authentication|incorrect.*api.*key|401|403/i.test(message);
}

export function isRetryableForKey(error: unknown): boolean {
  if (isKeyAuthError(error)) return true;
  if (!isFailoverableError(error)) return false;
  return true;
}

export function classifyStreamError(
  error: unknown,
  secrets: readonly (string | null | undefined)[] = [],
) {
  const classified = classifyGatewayError(error, secrets);
  return {
    statusCode: classified.httpStatus,
    errorCode: classified.code,
    message: classified.message,
  };
}

export function providerSecrets(route: ResolvedRoute, apiKey: string): string[] {
  return [apiKey, route.provider.baseUrl, ...Object.values(route.provider.headers ?? {})];
}

export function classifyGatewayError(
  error: unknown,
  secrets: readonly (string | null | undefined)[] = [],
): SafeGatewayError {
  if (isProviderTimeoutError(error)) {
    return {
      code: "gateway.timeout",
      message: "上游 Provider 请求超时",
      phase: "network",
      httpStatus: 504,
    };
  }
  const nested = (error as { lastError?: unknown } | null)?.lastError;
  const source = (nested ?? error) as { statusCode?: number };
  const httpStatus = typeof source?.statusCode === "number" ? source.statusCode : undefined;
  const rawMessage = error instanceof Error ? error.message : error != null ? String(error) : "生成失败";
  const message = redactSensitiveText(rawMessage, secrets);

  const explicitCode = (error as { code?: unknown } | null)?.code;
  let code = typeof explicitCode === "string" ? explicitCode : "generation_failed";
  if (code === "no_healthy_route") code = ErrorCode.ROUTING_NO_HEALTHY_ROUTE;
  if (httpStatus === 429) code = "rate_limited";
  else if (httpStatus === 401 || httpStatus === 403) code = "auth_error";
  else if (httpStatus !== undefined && httpStatus >= 500) code = "upstream_error";
  else if (NETWORK_KEYWORDS.test(rawMessage)) code = "network_error";

  return {
    code,
    message,
    phase: classifyError({ errorCode: code, httpStatus, errorMessage: message }).phase,
    httpStatus,
  };
}
