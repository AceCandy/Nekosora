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
import { recordFailure, recordSuccess } from "@/lib/circuit-breaker";
import { executeAtomicGateway, gatewayTelemetry, type GatewayAttemptAdapter } from "@/lib/gateway-execution";
import { selectMediaAdapter } from "@/lib/gateway-execution/media-registry";
import { createProviderFetch } from "@/lib/providers/timeouts";

export interface TranscribeOptions {
  /** 音频字节(必填)。 */
  audio: Buffer;
  /** MIME(如 audio/mpeg、audio/wav、audio/webm)。 */
  mime: string;
  /** 由音频内容测得并向上取整的计量秒数。 */
  durationSeconds: number;
  language?: string; // ISO-639-1,如 "zh"
  prompt?: string; // 引导词
  abortSignal?: AbortSignal;
  onProviderStart?: () => Promise<void>;
}

export interface TranscribeResult {
  text: string;
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

/** 通过路由链转写音频。 */
export async function transcribeViaRoute(
  ctx: CallContext,
  modelName: string,
  opts: TranscribeOptions,
): Promise<TranscribeResult> {
  const adapter: GatewayAttemptAdapter<never, string> = async function* ({ route, apiKey, abortSignal }) {
    const provider = createOpenAI({
      baseURL: route.provider.baseUrl,
      apiKey,
      name: route.provider.id,
      headers: route.provider.headers,
      fetch: createProviderFetch({ connectTimeoutMs: route.provider.connectTimeoutMs }),
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
      abortSignal,
    });
    return { value: result.text, usage: { sttSeconds: opts.durationSeconds } };
  };
  const outcome = await executeAtomicGateway({
    ctx,
    requestId: `stt_${crypto.randomUUID()}`,
    operation: "audio.transcription",
    model: modelName,
    requestPath: "/v1/audio/transcriptions",
    abortSignal: opts.abortSignal,
    resolveRoutes: () => resolveRoutesByCapability(ctx, modelName, "audioTranscription"),
    selectAdapter: (route) => selectMediaAdapter("audio.transcription", route.protocol, adapter),
    onProviderStart: opts.onProviderStart,
    telemetry: gatewayTelemetry,
    breaker: { recordSuccess, recordFailure },
  });
  if (outcome.status !== "success" || outcome.result === undefined || !outcome.route) {
    if (outcome.error?.phase === "routing" || outcome.error?.phase === "request") {
      throw new RoutingError(outcome.error.code, outcome.error.message);
    }
    throw new Error(outcome.error?.message ?? "语音转写失败");
  }
  return {
    text: outcome.result,
    providerRef: `${outcome.route.source}:${outcome.route.provider.id}`,
    providerName: outcome.route.provider.name,
    routeId: outcome.route.routeId,
    routeName: `${outcome.route.provider.name} · ${outcome.route.upstreamModelName}`,
    upstreamModel: outcome.route.upstreamModelName,
    upstreamKeyMasked: outcome.upstreamKeyMasked ?? null,
  };
}

export { RoutingError };
