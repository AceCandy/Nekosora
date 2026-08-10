import { classifyError } from "@/lib/error-classify";
import {
  describeGatewayGovernanceLimitError,
  ERROR_META,
  ErrorCode,
  type ErrorCodeValue,
} from "@/lib/errors";
import {
  acquireGatewayGovernanceLease,
  consumeGatewayGovernanceRate,
  type GatewayGovernanceHandle,
} from "@/lib/gateway-governance/lifecycle";
import { calculateChatReservation } from "@/lib/gateway-governance/metering";
import {
  GovernanceRejectedError,
  GovernanceStateError,
  type GatewayGovernanceOperation,
} from "@/lib/gateway-governance/repository";
import { resolveLocale, translateError } from "@/lib/i18n";
import type { CallContext } from "@/lib/providers/types";
import { redactErrorMessage } from "@/lib/redaction";
import { getRouteRepository } from "@/lib/repositories/route-repository";
import { logUsage } from "@/lib/usage";
import type { ParsedGatewayRequest, GatewayProtocol } from "./types";
import { authenticateGatewayRequest } from "./auth";
import {
  nonStreamProtocolResponse,
  protocolErrorResponse,
  streamProtocolResponse,
} from "./encoders";
import { GatewayRequestError, UnsupportedParameterError } from "./validation";

/** 四种入口共用的 HTTP 边界；parser/encoder 之间只调用一次 streamChat。 */
export async function handleProtocolRequest(
  request: Request,
  protocol: GatewayProtocol,
  requestPath: string,
  parse: (body: unknown) => ParsedGatewayRequest,
): Promise<Response> {
  const startedAt = Date.now();
  let ctx: CallContext | undefined;
  let governance: GatewayGovernanceHandle | undefined;
  let governanceTransferred = false;
  try {
    ctx = await authenticateGatewayRequest(request, protocol);
    const identity = gatewayGovernanceIdentity(ctx);
    const policy = await consumeGatewayGovernanceRate({
      identity,
      operation: "chat.request",
    });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new GatewayRequestError(ErrorCode.REQUEST_INVALID_JSON, "Request body is not valid JSON");
    }
    governance = await acquireGatewayGovernanceLease({
      identity,
      operation: chatGovernanceOperation(body, requestPath),
      policy,
      requestSignal: request.signal,
    });
    const parsed = parse(body);
    const model = await getRouteRepository().findEnabledModelByNameForOwner(
      parsed.request.model,
      ctx.userId,
    );
    const reservation = calculateChatReservation(parsed.request, {
      contextWindow: model?.contextWindow,
      maxOutputTokens: model?.maxOutputTokens,
    });
    await governance.reserveQuota("chat_tokens", reservation);
    const protocolGovernance = {
      handle: governance,
      reservation,
      serviceUnavailableMessage: translateError(
        ErrorCode.SERVER_SERVICE_UNAVAILABLE,
        resolveLocale(request.headers.get("accept-language")),
      ),
    };
    const response = parsed.stream
      ? streamProtocolResponse(
          protocol,
          ctx,
          parsed.request,
          governance.signal,
          requestPath,
          protocolGovernance,
        )
      : nonStreamProtocolResponse(
          protocol,
          ctx,
          parsed.request,
          governance.signal,
          requestPath,
          protocolGovernance,
        );
    governanceTransferred = true;
    return response;
  } catch (caught) {
    let error = caught;
    if (governance && !governanceTransferred) {
      try {
        await governance.finalize();
      } catch (settlementError) {
        error = settlementError;
      }
    }
    if (error instanceof GovernanceRejectedError) {
      const descriptor = describeGatewayGovernanceLimitError(error);
      const message = translateError(
        descriptor.code,
        resolveLocale(request.headers.get("accept-language")),
      );
      await logProtocolBoundaryError({
        startedAt,
        ctx,
        code: descriptor.code,
        message,
        requestPath,
      });
      return protocolErrorResponse(
        protocol,
        descriptor.code,
        message,
        descriptor.details,
        descriptor.headers,
      );
    }
    if (error instanceof GovernanceStateError) {
      const message = translateError(
        ErrorCode.SERVER_SERVICE_UNAVAILABLE,
        resolveLocale(request.headers.get("accept-language")),
      );
      await logProtocolBoundaryError({
        startedAt,
        ctx,
        code: ErrorCode.SERVER_SERVICE_UNAVAILABLE,
        message,
        requestPath,
      });
      return protocolErrorResponse(
        protocol,
        ErrorCode.SERVER_SERVICE_UNAVAILABLE,
        message,
      );
    }
    if (error instanceof GatewayRequestError) {
      const locale = resolveLocale(request.headers.get("accept-language"));
      const message = error instanceof UnsupportedParameterError
        ? error.message
        : translateError(error.code, locale);
      await logProtocolBoundaryError({
        startedAt,
        ctx,
        code: error.code,
        message,
        requestPath,
      });
      return protocolErrorResponse(protocol, error.code, message, error.details);
    }
    const message = redactErrorMessage(
      error,
      [],
      translateError(ErrorCode.SERVER_INTERNAL, resolveLocale(request.headers.get("accept-language"))),
    );
    await logProtocolBoundaryError({
      startedAt,
      ctx,
      code: ErrorCode.SERVER_INTERNAL,
      message,
      requestPath,
    });
    return protocolErrorResponse(
      protocol,
      ErrorCode.SERVER_INTERNAL,
      message,
    );
  }
}

function gatewayGovernanceIdentity(ctx: CallContext): { userId: string; apiKeyId: string } {
  if (!ctx.apiKeyId) throw new GovernanceStateError("Gateway API key identity is unavailable");
  return { userId: ctx.userId, apiKeyId: ctx.apiKeyId };
}

function chatGovernanceOperation(body: unknown, requestPath: string): GatewayGovernanceOperation {
  const stream = requestPath.endsWith(":streamGenerateContent")
    || (body !== null
      && typeof body === "object"
      && (body as { stream?: unknown }).stream === true);
  return stream ? "chat.stream" : "chat.generate";
}

async function logProtocolBoundaryError(opts: {
  startedAt: number;
  ctx?: CallContext;
  code: ErrorCodeValue;
  message: string;
  requestPath: string;
}): Promise<void> {
  const httpStatus = ERROR_META[opts.code].status;
  try {
    await logUsage({
      ctx: opts.ctx ?? {
        userId: "",
        apiKeyId: null,
        keyKind: null,
        source: "gateway",
      },
      runId: `err_${crypto.randomUUID()}`,
      model: "(unknown)",
      usage: {},
      latencyMs: Date.now() - opts.startedAt,
      status: "failed",
      errorCode: opts.code,
      errorMessage: opts.message,
      httpStatus,
      requestPath: opts.requestPath,
      errorPhase: classifyError({
        errorCode: opts.code,
        httpStatus,
        errorMessage: opts.message,
      }).phase,
      errorType: opts.code,
    });
  } catch {
    /* 入口遥测失败不得改变协议响应。 */
  }
}
