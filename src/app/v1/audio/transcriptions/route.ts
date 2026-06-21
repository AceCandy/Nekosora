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
import { apiErrorLocalized, ErrorCode, routingCodeToErrorCode } from "@/lib/errors";
import { logUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) return apiErrorLocalized(ErrorCode.AUTH_MISSING_KEY, req);
  const verified = await verifyKey(rawKey);
  if (!verified) return apiErrorLocalized(ErrorCode.AUTH_INVALID_KEY, req);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiErrorLocalized(ErrorCode.REQUEST_INVALID_JSON, req);
  }

  const model = String(formData.get("model") ?? "");
  const file = formData.get("file");
  const language = String(formData.get("language") ?? "") || undefined;
  const prompt = String(formData.get("prompt") ?? "") || undefined;

  if (!model) return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["model"] });
  if (!(file instanceof File)) {
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["file"] });
  }

  const audio = Buffer.from(await file.arrayBuffer());
  const ctx = verified.ctx;
  const startedAt = Date.now();

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
    });
    return NextResponse.json({ text: result.text });
  } catch (err) {
    if (err instanceof RoutingError) return apiErrorLocalized(routingCodeToErrorCode(err.code), req);
    console.error("[/v1/audio/transcriptions] 失败:", err);
    await safeLogUsage({
      ctx,
      runId: `stt_${crypto.randomUUID()}`,
      model,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "failed",
      errorCode: "generation_failed",
    });
    return apiErrorLocalized(
      ErrorCode.MEDIA_STT_FAILED,
      req,
      err instanceof Error ? { message: err.message } : undefined,
    );
  }
}

async function safeLogUsage(params: Parameters<typeof logUsage>[0]): Promise<void> {
  try {
    await logUsage(params);
  } catch {
    /* 用量记录失败不阻断 */
  }
}
