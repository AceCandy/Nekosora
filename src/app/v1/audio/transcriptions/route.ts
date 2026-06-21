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
import { logUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) return openaiError("缺少 Authorization: Bearer 头", "missing_api_key", 401);
  const verified = await verifyKey(rawKey);
  if (!verified) return openaiError("无效或已禁用的 API 密钥", "invalid_api_key", 401);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return openaiError("请求体必须是 multipart/form-data", "invalid_request_error", 400);
  }

  const model = String(formData.get("model") ?? "");
  const file = formData.get("file");
  const language = String(formData.get("language") ?? "") || undefined;
  const prompt = String(formData.get("prompt") ?? "") || undefined;

  if (!model) return openaiError("model 为必填项", "invalid_request_error", 400);
  if (!(file instanceof File)) return openaiError("file 为必填项(音频文件)", "invalid_request_error", 400);

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
    if (err instanceof RoutingError) return openaiError(err.message, err.code, 400);
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
    return openaiError(
      err instanceof Error ? err.message : "语音转写失败",
      "generation_failed",
      502,
    );
  }
}

function openaiError(message: string, code: string, status: number) {
  return NextResponse.json(
    { error: { message, type: status >= 500 ? "server_error" : "invalid_request_error", code } },
    { status },
  );
}

async function safeLogUsage(params: Parameters<typeof logUsage>[0]): Promise<void> {
  try {
    await logUsage(params);
  } catch {
    /* 用量记录失败不阻断 */
  }
}
