import { classifyError, NETWORK_KEYWORDS } from "@/lib/error-classify";
import { redactSensitiveText } from "@/lib/redaction";
import type { ResolvedRoute } from "@/lib/providers/types";
import type { SafeGatewayError } from "./types";

export function isAbortError(error: unknown): boolean {
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
  const nested = (error as { lastError?: unknown } | null)?.lastError;
  const source = (nested ?? error) as { statusCode?: number };
  const httpStatus = typeof source?.statusCode === "number" ? source.statusCode : undefined;
  const rawMessage = error instanceof Error ? error.message : error != null ? String(error) : "生成失败";
  const message = redactSensitiveText(rawMessage, secrets);

  const explicitCode = (error as { code?: unknown } | null)?.code;
  let code = typeof explicitCode === "string" ? explicitCode : "generation_failed";
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
