import { extractBearer, verifyKey } from "@/lib/keys";
import { ErrorCode } from "@/lib/errors";
import type { CallContext } from "@/lib/providers/types";
import type { GatewayProtocol } from "./types";
import { GatewayRequestError, UnsupportedParameterError } from "./validation";

/** 按入口协议提取 Key，但统一复用现有 verifyKey 和权限上下文。 */
export async function authenticateGatewayRequest(
  request: Request,
  protocol: GatewayProtocol,
): Promise<CallContext> {
  if (protocol === "gemini" && new URL(request.url).searchParams.has("key")) {
    throw new UnsupportedParameterError("key");
  }

  const bearer = extractBearer(request.headers.get("authorization"));
  const nativeHeader = protocol === "anthropic"
    ? request.headers.get("x-api-key")
    : protocol === "gemini"
      ? request.headers.get("x-goog-api-key")
      : null;
  const nativeKey = nativeHeader?.trim() || null;
  if (bearer && nativeKey && bearer !== nativeKey) {
    throw new GatewayRequestError(ErrorCode.AUTH_INVALID_KEY, "Conflicting API keys");
  }
  const rawKey = bearer ?? nativeKey;
  if (!rawKey) throw new GatewayRequestError(ErrorCode.AUTH_MISSING_KEY, "Missing API key");
  const verified = await verifyKey(rawKey);
  if (!verified) throw new GatewayRequestError(ErrorCode.AUTH_INVALID_KEY, "Invalid API key");
  return verified.ctx;
}
