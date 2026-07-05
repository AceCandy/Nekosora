/**
 * 文字转语音适配器 —— P1-D(TTS 兼容)。
 *
 * 复用路由器,调 AI SDK v5 的 generateSpeech。
 * 返回 audio buffer(mime 由调用方端点透传给客户端)。
 */
import { generateSpeech as generateSpeech } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { CallContext } from "@/lib/providers/types";
import { resolveRoutesByCapability, RoutingError } from "@/lib/routing";

export interface SynthesizeOptions {
  text: string;
  voice?: string; // OpenAI: alloy/echo/fable/onyx/nova/shimmer
  /** 输出格式(默认 mp3)。 */
  outputFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
}

export interface SynthesizeResult {
  audioBuffer: Buffer;
  mime: string;
  providerRef?: string;
}

const FORMAT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

/** 通过路由链合成语音。 */
export async function synthesizeViaRoute(
  ctx: CallContext,
  modelName: string,
  opts: SynthesizeOptions,
): Promise<SynthesizeResult> {
  const routes = await resolveRoutesByCapability(ctx, modelName, "audioSynthesis");
  const route = routes[0];
  const format = opts.outputFormat ?? "mp3";
  const provider = createOpenAI({
    baseURL: route.provider.baseUrl,
    apiKey: route.provider.apiKey,
    name: route.provider.id,
    headers: route.provider.headers,
  });
  const model = provider.speech(route.upstreamModelName);

  const result = await generateSpeech({
    model,
    text: opts.text,
    voice: opts.voice,
    providerOptions: { openai: { response_format: format } },
  });

  // AI SDK v5 的 SpeechResult.audio 是 GeneratedAudioFile(含 uint8Array + format)。
  const u8 = result.audio.uint8Array;
  if (!u8) throw new Error("TTS 上游未返回音频数据");
  return {
    audioBuffer: Buffer.from(u8),
    mime: FORMAT_MIME[format] ?? "audio/mpeg",
    providerRef: `${route.source}:${route.provider.id}`,
  };
}

export { RoutingError };
