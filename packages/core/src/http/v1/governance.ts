import {
  apiErrorLocalized,
  describeGatewayGovernanceLimitError,
  ErrorCode,
} from "@/lib/errors";
import {
  GovernanceRejectedError,
  GovernanceStateError,
} from "@/lib/gateway-governance/repository";
import { resolveLocale, translateError } from "@/lib/i18n";
import { protocolErrorResponse } from "@/lib/protocols/encoders";
import type { GatewayProtocol } from "@/lib/protocols/types";
import type { CallContext } from "@/lib/providers/types";

export function gatewayGovernanceIdentity(
  ctx: CallContext,
): { userId: string; apiKeyId: string } {
  if (!ctx.apiKeyId) throw new GovernanceStateError("Gateway API key identity is unavailable");
  return { userId: ctx.userId, apiKeyId: ctx.apiKeyId };
}

export async function gatewayGovernanceErrorResponse(
  error: unknown,
  request: Request,
  protocol?: GatewayProtocol,
): Promise<Response | null> {
  if (error instanceof GovernanceRejectedError) {
    const descriptor = describeGatewayGovernanceLimitError(error);
    if (protocol) {
      const message = translateError(
        descriptor.code,
        resolveLocale(request.headers.get("accept-language")),
      );
      return protocolErrorResponse(
        protocol,
        descriptor.code,
        message,
        descriptor.details,
        descriptor.headers,
      );
    }
    return apiErrorLocalized(
      descriptor.code,
      request,
      descriptor.details,
      descriptor.headers,
    );
  }
  if (error instanceof GovernanceStateError) {
    if (protocol) {
      const message = translateError(
        ErrorCode.SERVER_SERVICE_UNAVAILABLE,
        resolveLocale(request.headers.get("accept-language")),
      );
      return protocolErrorResponse(protocol, ErrorCode.SERVER_SERVICE_UNAVAILABLE, message);
    }
    return apiErrorLocalized(ErrorCode.SERVER_SERVICE_UNAVAILABLE, request);
  }
  return null;
}
