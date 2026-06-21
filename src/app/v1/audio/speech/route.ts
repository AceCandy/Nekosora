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
import { logUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 4096; // OpenAI TTS 输入上限

export async function POST(req: NextRequest) {
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) return openaiError("缺少 Authorization: Bearer 头", "missing_api_key", 401);
  const verified = await verifyKey(rawKey);
  if (!verified) return openaiError("无效或已禁用的 API 密钥", "invalid_api_key", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return openaiError("请求体不是合法 JSON", "invalid_request_error", 400);
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

  if (!model) return openaiError("model 为必填项", "invalid_request_error", 400);
  if (!input) return openaiError("input 为必填项(待合成文本)", "invalid_request_error", 400);
  if (input.length > MAX_INPUT_CHARS) {
    return openaiError(`input 超过 ${MAX_INPUT_CHARS} 字符上限`, "invalid_request_error", 400);
  }

  const ctx = verified.ctx;
  const startedAt = Date.now();

  try {
    const result = await synthesizeViaRoute(ctx, model, {
      text: input,
      voice,
      outputFormat,
    });
    await safeLogUsage({
      ctx,
      runId: `tts_${crypto.randomUUID()}`,
      model,
      providerRef: result.providerRef,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "success",
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
    if (err instanceof RoutingError) return openaiError(err.message, err.code, 400);
    console.error("[/v1/audio/speech] 失败:", err);
    await safeLogUsage({
      ctx,
      runId: `tts_${crypto.randomUUID()}`,
      model,
      usage: {},
      latencyMs: Date.now() - startedAt,
      status: "failed",
      errorCode: "generation_failed",
    });
    return openaiError(
      err instanceof Error ? err.message : "语音合成失败",
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
