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
import { recordFailure, recordSuccess } from "@/lib/circuit-breaker";
import { executeAtomicGateway, gatewayTelemetry, type GatewayAttemptAdapter } from "@/lib/gateway-execution";
import { selectMediaAdapter } from "@/lib/gateway-execution/media-registry";
import { countUnicodeCodePoints } from "@/lib/gateway-governance/metering";
import { createProviderFetch } from "@/lib/providers/timeouts";

export interface SynthesizeOptions {
  text: string;
  voice?: string; // OpenAI: alloy/echo/fable/onyx/nova/shimmer
  /** 输出格式(默认 mp3)。 */
  outputFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  abortSignal?: AbortSignal;
  onProviderStart?: () => Promise<void>;
}

export interface SynthesizeResult {
  audioBuffer: Buffer;
  mime: string;
  providerRef?: string;
  /** 可读服务商名快照(用量日志展示)。 */
  providerName?: string;
  /** 命中路由 id 溯源。 */
  routeId?: string;
  /** 组合路由展示名(providerName · upstreamModelName)。 */
  routeName?: string;
  /** 真实上游模型名。 */
  upstreamModel?: string;
  /** 命中上游 key 的脱敏快照(前3后3,中间 *)。 */
  upstreamKeyMasked?: string | null;
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
  const adapter: GatewayAttemptAdapter<never, { audioBuffer: Buffer; mime: string }> =
    async function* ({ route, apiKey, abortSignal }) {
    const format = opts.outputFormat ?? "mp3";
    const provider = createOpenAI({
      baseURL: route.provider.baseUrl,
      apiKey,
      name: route.provider.id,
      headers: route.provider.headers,
      fetch: createProviderFetch({ connectTimeoutMs: route.provider.connectTimeoutMs }),
    });
    const model = provider.speech(route.upstreamModelName);

    const result = await generateSpeech({
      model,
      text: opts.text,
      voice: opts.voice,
      providerOptions: { openai: { response_format: format } },
      abortSignal,
    });

    // AI SDK v5 的 SpeechResult.audio 是 GeneratedAudioFile(含 uint8Array + format)。
    const u8 = result.audio.uint8Array;
    if (!u8) throw new Error("TTS 上游未返回音频数据");
    return {
      value: {
        audioBuffer: Buffer.from(u8),
        mime: FORMAT_MIME[format] ?? "audio/mpeg",
      },
      usage: { ttsCodePoints: countUnicodeCodePoints(opts.text) },
    };
  };
  const outcome = await executeAtomicGateway({
    ctx,
    requestId: `tts_${crypto.randomUUID()}`,
    operation: "audio.speech",
    model: modelName,
    requestPath: "/v1/audio/speech",
    abortSignal: opts.abortSignal,
    resolveRoutes: () => resolveRoutesByCapability(ctx, modelName, "audioSynthesis"),
    selectAdapter: (route) => selectMediaAdapter("audio.speech", route.protocol, adapter),
    onProviderStart: opts.onProviderStart,
    telemetry: gatewayTelemetry,
    breaker: { recordSuccess, recordFailure },
  });
  if (outcome.status !== "success" || !outcome.result || !outcome.route) {
    if (outcome.error?.phase === "routing" || outcome.error?.phase === "request") {
      throw new RoutingError(outcome.error.code, outcome.error.message);
    }
    throw new Error(outcome.error?.message ?? "语音合成失败");
  }
  return {
    ...outcome.result,
    providerRef: `${outcome.route.source}:${outcome.route.provider.id}`,
    providerName: outcome.route.provider.name,
    routeId: outcome.route.routeId,
    routeName: `${outcome.route.provider.name} · ${outcome.route.upstreamModelName}`,
    upstreamModel: outcome.route.upstreamModelName,
    upstreamKeyMasked: outcome.upstreamKeyMasked ?? null,
  };
}

export { RoutingError };
