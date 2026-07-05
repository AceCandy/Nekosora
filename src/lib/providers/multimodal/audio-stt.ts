/**
 * 语音转文字适配器 —— P1-D(Whisper 兼容)。
 *
 * 复用路由器,调 AI SDK v5 的 transcribe。
 * OpenAI 兼容上游(audio.transcriptions.create 语义)。
 */
import { transcribe as transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { CallContext } from "@/lib/providers/types";
import { resolveRoutesByCapability, RoutingError } from "@/lib/routing";

export interface TranscribeOptions {
  /** 音频字节(必填)。 */
  audio: Buffer;
  /** MIME(如 audio/mpeg、audio/wav、audio/webm)。 */
  mime: string;
  language?: string; // ISO-639-1,如 "zh"
  prompt?: string; // 引导词
}

export interface TranscribeResult {
  text: string;
  providerRef?: string;
}

/** 通过路由链转写音频。 */
export async function transcribeViaRoute(
  ctx: CallContext,
  modelName: string,
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const routes = await resolveRoutesByCapability(ctx, modelName, "audioTranscription");
  const route = routes[0];
  const provider = createOpenAI({
    baseURL: route.provider.baseUrl,
    apiKey: route.provider.apiKey,
    name: route.provider.id,
    headers: route.provider.headers,
  });
  const model = provider.transcription(route.upstreamModelName);

  const result = await transcribe({
    model,
    // AI SDK v5 DataContent 接受 Uint8Array / ArrayBuffer / Buffer / URL。
    audio: new Uint8Array(opts.audio),
    providerOptions: {
      openai: {
        ...(opts.language ? { language: opts.language } : {}),
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
      },
    },
  });

  return { text: result.text, providerRef: `${route.source}:${route.provider.id}` };
}

export { RoutingError };
