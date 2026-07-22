/**
 * 语音转文字端点 —— POST /v1/audio/transcriptions
 *
 * OpenAI Whisper API 兼容(multipart/form-data)。
 * 鉴权:Authorization: Bearer sk-xxx。
 *
 * 必填字段:model(对外模型名,需 capabilities.audioTranscription:true)、file(音频)。
 * 可选:language、prompt。
 *
 * 响应:{ text: "..." }(默认 response_format=text/json)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { verifyKey, extractBearer } from "@/lib/keys";
import { transcribeViaRoute, RoutingError } from "@/lib/providers/multimodal/audio-stt";
import {
  apiErrorLocalized,
  ErrorCode,
  routingCodeToErrorCode,
  ERROR_META,
} from "@/lib/errors";
import { classifyError } from "@/lib/error-classify";
import { logUsage } from "@/lib/usage";
import type { CallContext } from "@/lib/providers/types";
import {
  parseBoundedMultipartFormData,
  RequestBodyTooLargeError,
} from "@/lib/multipart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 请求路径常量(错误日志 requestPath 用)。 */
const REQUEST_PATH = "/v1/audio/transcriptions";
export const MAX_TRANSCRIPTION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TRANSCRIPTION_BODY_BYTES =
  MAX_TRANSCRIPTION_FILE_BYTES + 1024 * 1024;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) {
    await logRouteError({ startedAt, code: ErrorCode.AUTH_MISSING_KEY });
    return apiErrorLocalized(ErrorCode.AUTH_MISSING_KEY, req);
  }
  const verified = await verifyKey(rawKey);
  if (!verified) {
    await logRouteError({ startedAt, code: ErrorCode.AUTH_INVALID_KEY });
    return apiErrorLocalized(ErrorCode.AUTH_INVALID_KEY, req);
  }

  let formData: FormData;
  try {
    formData = await parseBoundedMultipartFormData(
      req,
      MAX_TRANSCRIPTION_BODY_BYTES,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      await logRouteError({
        startedAt,
        ctx: verified.ctx,
        code: ErrorCode.REQUEST_PAYLOAD_TOO_LARGE,
      });
      return apiErrorLocalized(ErrorCode.REQUEST_PAYLOAD_TOO_LARGE, req, {
        maxFileBytes: MAX_TRANSCRIPTION_FILE_BYTES,
      });
    }
    await logRouteError({ startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_INVALID_JSON });
    return apiErrorLocalized(ErrorCode.REQUEST_INVALID_JSON, req);
  }

  const model = String(formData.get("model") ?? "");
  const file = formData.get("file");
  const language = String(formData.get("language") ?? "") || undefined;
  const prompt = String(formData.get("prompt") ?? "") || undefined;

  if (!model) {
    await logRouteError({ startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_MISSING_FIELD });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["model"] });
  }
  if (!(file instanceof File)) {
    await logRouteError({
      startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_MISSING_FIELD, model,
    });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["file"] });
  }
  if (file.size > MAX_TRANSCRIPTION_FILE_BYTES) {
    await logRouteError({
      startedAt,
      ctx: verified.ctx,
      model,
      code: ErrorCode.REQUEST_PAYLOAD_TOO_LARGE,
    });
    return apiErrorLocalized(ErrorCode.REQUEST_PAYLOAD_TOO_LARGE, req, {
      maxFileBytes: MAX_TRANSCRIPTION_FILE_BYTES,
    });
  }

  const audio = Buffer.from(await file.arrayBuffer());
  const ctx = verified.ctx;

  try {
    const result = await transcribeViaRoute(ctx, model, {
      audio,
      mime: file.type || "audio/mpeg",
      language,
      prompt,
    });
    await safeLogUsage({
      ctx,
      runId: `stt_${crypto.randomUUID()}`,
      model,
      providerRef: result.providerRef,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "success",
      // 路由可读信息快照(与 stream.ts 同款)。
      providerName: result.providerName,
      routeId: result.routeId,
      routeName: result.routeName,
      upstreamModel: result.upstreamModel,
      upstreamKeyMasked: result.upstreamKeyMasked,
    });
    return NextResponse.json({ text: result.text });
  } catch (err) {
    // 路由/能力解析失败(适配器内部抛 RoutingError):补写 ops_error_logs。
    if (err instanceof RoutingError) {
      const code = routingCodeToErrorCode(err.code);
      await logRouteError({ startedAt, ctx, model, code, errorMessage: err.message });
      return apiErrorLocalized(code, req);
    }
    console.error("[/v1/audio/transcriptions] 失败:", err);
    const code = ErrorCode.MEDIA_STT_FAILED;
    await safeLogUsage({
      ctx,
      runId: `stt_${crypto.randomUUID()}`,
      model,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "failed",
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
      httpStatus: ERROR_META[code].status,
      requestPath: REQUEST_PATH,
      errorPhase: classifyError({ errorCode: code, httpStatus: ERROR_META[code].status }).phase,
      errorType: code,
    });
    return apiErrorLocalized(
      code,
      req,
      err instanceof Error ? { message: err.message } : undefined,
    );
  }
}

/**
 * 记录一条 route 层(调适配器前)的失败请求到 ops_error_logs。
 * ctx 缺失(鉴权失败)时构造空身份,userId 由 logUsage 收敛为 null。
 */
async function logRouteError(opts: {
  startedAt: number;
  ctx?: CallContext;
  model?: string;
  code: string;
  errorMessage?: string;
}): Promise<void> {
  const ctx: CallContext = opts.ctx ?? {
    userId: "",
    apiKeyId: null,
    keyKind: null,
    source: "gateway",
  };
  const httpStatus = ERROR_META[opts.code as keyof typeof ERROR_META]?.status;
  try {
    await logUsage({
      ctx,
      runId: `err_${crypto.randomUUID()}`,
      model: opts.model ?? "(unknown)",
      usage: {},
      latencyMs: Date.now() - opts.startedAt,
      status: "failed",
      errorCode: opts.code,
      errorMessage: opts.errorMessage,
      httpStatus,
      requestPath: REQUEST_PATH,
      errorPhase: classifyError({ errorCode: opts.code, httpStatus }).phase,
      errorType: opts.code,
    });
  } catch {
    /* 日志失败不阻断主流程 */
  }
}

async function safeLogUsage(params: Parameters<typeof logUsage>[0]): Promise<void> {
  try {
    await logUsage(params);
  } catch {
    /* 用量记录失败不阻断 */
  }
}
