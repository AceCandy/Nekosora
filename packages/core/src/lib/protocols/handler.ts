import { classifyError } from "@/lib/error-classify";
import { ERROR_META, ErrorCode, type ErrorCodeValue } from "@/lib/errors";
import { resolveLocale, translateError } from "@/lib/i18n";
import type { CallContext } from "@/lib/providers/types";
import { redactErrorMessage } from "@/lib/redaction";
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
  try {
    ctx = await authenticateGatewayRequest(request, protocol);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new GatewayRequestError(ErrorCode.REQUEST_INVALID_JSON, "Request body is not valid JSON");
    }
    const parsed = parse(body);
    return parsed.stream
      ? streamProtocolResponse(protocol, ctx, parsed.request, request.signal, requestPath)
      : nonStreamProtocolResponse(protocol, ctx, parsed.request, request.signal, requestPath);
  } catch (error) {
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
