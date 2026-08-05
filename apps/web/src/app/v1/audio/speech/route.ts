/**
 * 文字转语音端点 —— POST /v1/audio/speech
 *
 * OpenAI TTS API 兼容。
 * 鉴权:Authorization: Bearer sk-xxx。
 *
 * 必填:model(需 capabilities.audioSynthesis:true)、input(待合成文本)、voice。
 * 可选:response_format(默认 mp3)。
 *
 * 响应:音频字节流(对应 Content-Type)。直接 pipe 到 Response。
 */
import { type NextRequest, NextResponse } from "next/server";
import { verifyKey, extractBearer } from "@/lib/keys";
import { synthesizeViaRoute, RoutingError } from "@/lib/providers/multimodal/audio-tts";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 4096; // OpenAI TTS 输入上限
/** 请求路径常量(错误日志 requestPath 用)。 */
const REQUEST_PATH = "/v1/audio/speech";

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await logRouteError({ startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_INVALID_JSON });
    return apiErrorLocalized(ErrorCode.REQUEST_INVALID_JSON, req);
  }

  const model = body.model as string | undefined;
  const input = body.input as string | undefined;
  const voice = (body.voice as string | undefined) || undefined;
  const outputFormat = (body.response_format as
    | "mp3"
    | "opus"
    | "aac"
    | "flac"
    | "wav"
    | "pcm"
    | undefined);

  if (!model) {
    await logRouteError({ startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_MISSING_FIELD });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["model"] });
  }
  if (!input) {
    await logRouteError({
      startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_MISSING_FIELD, model,
    });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["input"] });
  }
  if (input.length > MAX_INPUT_CHARS) {
    await logRouteError({
      startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_MISSING_FIELD, model,
    });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { limit: MAX_INPUT_CHARS, field: "input" });
  }

  const ctx = verified.ctx;

  try {
    const result = await synthesizeViaRoute(ctx, model, {
      text: input,
      voice,
      outputFormat,
    });
    return new NextResponse(new Uint8Array(result.audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": result.mime,
        "Content-Length": String(result.audioBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const safeMessage = redactErrorMessage(err);
    // 路由/能力解析失败由 route 层写入最终 execution 事实。
    if (err instanceof RoutingError) {
      const code = routingCodeToErrorCode(err.code);
      return apiErrorLocalized(code, req);
    }
    console.error("[/v1/audio/speech] 失败:", safeMessage);
    const code = ErrorCode.MEDIA_TTS_FAILED;
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
