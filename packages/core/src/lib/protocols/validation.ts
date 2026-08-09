import { ErrorCode, type ErrorCodeValue } from "@/lib/errors";

export type JsonObject = Record<string, unknown>;

/** 协议边界的安全请求错误，可直接映射到统一 ErrorCode。 */
export class GatewayRequestError extends Error {
  constructor(
    readonly code: ErrorCodeValue,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

/** 无法可靠转换的参数，必须在触网前拒绝。 */
export class UnsupportedParameterError extends GatewayRequestError {
  constructor(readonly parameter: string) {
    super(
      ErrorCode.REQUEST_UNSUPPORTED_PARAMETER,
      `Unsupported parameter: '${parameter}'.`,
      { parameter },
    );
    this.name = "UnsupportedParameterError";
  }
}

export function unsupported(parameter: string): never {
  throw new UnsupportedParameterError(parameter);
}

export function invalid(message = "请求体格式无效"): never {
  throw new GatewayRequestError(ErrorCode.REQUEST_INVALID_JSON, message);
}

export function missing(...fields: string[]): never {
  throw new GatewayRequestError(
    ErrorCode.REQUEST_MISSING_FIELD,
    `Missing required field: ${fields.join(", ")}`,
    { fields },
  );
}

export function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} 必须是对象`);
  return value as JsonObject;
}

export function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(`${path} 必须是字符串`);
  return value;
}

export function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${path} 必须是有限数字`);
  return value;
}

export function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${path} 必须是数组`);
  return value;
}

export function assertAllowed(object: JsonObject, allowed: readonly string[], prefix = ""): void {
  const set = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!set.has(key)) unsupported(prefix ? `${prefix}.${key}` : key);
  }
}
