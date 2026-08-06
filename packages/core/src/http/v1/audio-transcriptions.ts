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
import { verifyKey, extractBearer } from "@/lib/keys";
import { transcribeViaRoute, RoutingError } from "@/lib/providers/multimodal/audio-stt";
import {
  apiErrorLocalized,
  ErrorCode,
  routingCodeToErrorCode,
  ERROR_META,
} from "@/lib/errors";
import { classifyError } from "@/lib/error-classify";
import { redactErrorMessage } from "@/lib/redaction";
import { logUsage } from "@/lib/usage";
import type { CallContext } from "@/lib/providers/types";
import {
  parseBoundedMultipartFormData,
  RequestBodyTooLargeError,
} from "@/lib/multipart";
import {
  MAX_TRANSCRIPTION_BODY_BYTES,
  MAX_TRANSCRIPTION_FILE_BYTES,
} from "./transcription-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 请求路径常量(错误日志 requestPath 用)。 */
const REQUEST_PATH = "/v1/audio/transcriptions";

export async function POST(req: Request) {
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
    return Response.json({ text: result.text });
  } catch (err) {
    const safeMessage = redactErrorMessage(err);
    // 路由/能力解析失败由 route 层写入最终 execution 事实。
    if (err instanceof RoutingError) {
      const code = routingCodeToErrorCode(err.code);
      return apiErrorLocalized(code, req);
    }
    console.error("[/v1/audio/transcriptions] 失败:", safeMessage);
    const code = ErrorCode.MEDIA_STT_FAILED;
    return apiErrorLocalized(
      code,
      req,
      err instanceof Error ? { message: safeMessage } : undefined,
    );
  }
}

/**
 * 记录一条发生在执行引擎之外的 route 层失败请求。
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
