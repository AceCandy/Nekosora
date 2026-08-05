import type { ProviderProtocol } from "@/db/types";
import type { GatewayAttemptAdapter, GatewayOperation } from "./types";

const MEDIA_PROTOCOLS: Partial<Record<GatewayOperation, readonly ProviderProtocol[]>> = {
  "image.generate": ["openai", "openai-compatible", "openai-images"],
  "audio.speech": ["openai", "openai-compatible", "openai-audio-tts"],
  "audio.transcription": ["openai", "openai-compatible", "openai-audio-stt"],
};

export function selectMediaAdapter<T>(
  operation: GatewayOperation,
  protocol: ProviderProtocol,
  adapter: GatewayAttemptAdapter<never, T>,
): GatewayAttemptAdapter<never, T> | null {
  return MEDIA_PROTOCOLS[operation]?.includes(protocol) ? adapter : null;
}
