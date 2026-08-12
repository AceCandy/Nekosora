import type { IAudioMetadata } from "music-metadata";
import type { IRRequest, IRUsage } from "@/lib/providers/types";
import { estimateMessagesTokens } from "@/lib/tokens";

const DEFAULT_CONTEXT_WINDOW = 32_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MAX_IMAGE_COUNT = 10;
export const MAX_TTS_CODE_POINTS = 4_096;

export type AudioMetadataParser = (
  buffer: Uint8Array,
  fileInfo: { mimeType: string },
  options: { duration: true },
) => Promise<Pick<IAudioMetadata, "format">>;

export interface ChatCatalogLimits {
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
}

export function calculateChatReservation(
  request: Pick<IRRequest, "messages" | "max_tokens">,
  catalog: ChatCatalogLimits = {},
): number {
  const inputTokens = estimateMessagesTokens(request.messages);
  const contextWindow = positiveSafeInteger(catalog.contextWindow)
    ? catalog.contextWindow
    : DEFAULT_CONTEXT_WINDOW;
  const catalogOutput = positiveSafeInteger(catalog.maxOutputTokens)
    ? catalog.maxOutputTokens
    : DEFAULT_MAX_OUTPUT_TOKENS;
  const requestedOutput = request.max_tokens === undefined
    ? catalogOutput
    : requirePositiveSafeInteger(request.max_tokens, "max_tokens");
  const availableOutput = Math.max(0, contextWindow - inputTokens);
  return inputTokens + Math.min(requestedOutput, catalogOutput, availableOutput);
}

export function settleChatUsage(
  reservation: number,
  providerStarted: boolean,
  usage?: IRUsage,
): number {
  if (!providerStarted) return 0;
  if (nonNegativeSafeInteger(usage?.totalTokens)) return usage.totalTokens;
  if (
    nonNegativeSafeInteger(usage?.inputTokens)
    && nonNegativeSafeInteger(usage?.outputTokens)
  ) {
    const total = usage.inputTokens + usage.outputTokens;
    if (Number.isSafeInteger(total)) return total;
  }
  return reservation;
}

export function parseImageCount(value: unknown): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_IMAGE_COUNT) {
    throw new Error("Image n must be an integer between 1 and 10");
  }
  return value as number;
}

export function countUnicodeCodePoints(input: string): number {
  return Array.from(input).length;
}

export function parseTtsInput(input: unknown): { input: string; units: number } {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("TTS input must be a non-empty string");
  }
  const units = countUnicodeCodePoints(input);
  if (units > MAX_TTS_CODE_POINTS) {
    throw new Error(`TTS input must not exceed ${MAX_TTS_CODE_POINTS} code points`);
  }
  return { input, units };
}

export async function measureSttSeconds(
  buffer: Buffer,
  mimeType: string,
  parser: AudioMetadataParser = defaultAudioMetadataParser,
): Promise<number> {
  const metadata = await parser(buffer, { mimeType }, { duration: true });
  const { container, duration, hasAudio } = metadata.format;
  if (
    !isSupportedAudioContainer(container, metadata.format.codec)
    || hasAudio === false
    || !Number.isFinite(duration)
    || (duration ?? 0) <= 0
  ) {
    throw new Error("Audio duration cannot be measured reliably");
  }
  return Math.ceil(duration as number);
}

export function settleReservedUsage(reservation: number, providerStarted: boolean): number {
  return providerStarted ? reservation : 0;
}

async function defaultAudioMetadataParser(
  buffer: Uint8Array,
  fileInfo: { mimeType: string },
  options: { duration: true },
): Promise<Pick<IAudioMetadata, "format">> {
  const { parseBuffer } = await import("music-metadata");
  return parseBuffer(buffer, fileInfo, options);
}

function isSupportedAudioContainer(container: string | undefined, codec: string | undefined): boolean {
  if (!container) return false;
  const normalized = container.toUpperCase();
  if (
    normalized === "MPEG"
    || normalized.startsWith("ADTS/MPEG-")
    || normalized === "FLAC"
    || normalized === "OGG"
    || normalized === "WAVE"
    || normalized === "EBML/WEBM"
    || normalized === "EBML/MATROSKA"
  ) {
    return true;
  }
  const mp4Brands = new Set([
    "M4A", "ISOM", "ISO2", "ISO5", "ISO6", "MP41", "MP42", "QT", "3GP5", "AVC1",
  ]);
  return normalized.split("/").some((brand) => mp4Brands.has(brand))
    && (codec === undefined || /AAC|ALAC|MPEG-4/i.test(codec));
}

function positiveSafeInteger(value: number | null | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function nonNegativeSafeInteger(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function requirePositiveSafeInteger(value: number, field: string): number {
  if (!positiveSafeInteger(value)) throw new Error(`${field} must be a positive safe integer`);
  return value;
}
