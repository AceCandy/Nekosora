import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRoutesByCapability: vi.fn(),
}));

vi.mock("ai", () => ({
  generateSpeech: vi.fn(),
  transcribe: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    speech: vi.fn(() => ({ modelId: "speech-model" })),
    transcription: vi.fn(() => ({ modelId: "transcription-model" })),
  })),
}));
vi.mock("@/lib/routing", () => ({
  resolveRoutesByCapability: (...args: unknown[]) =>
    mocks.resolveRoutesByCapability(...args),
  RoutingError: class RoutingError extends Error {},
}));

import { generateSpeech, transcribe } from "ai";
import { transcribeViaRoute } from "@/lib/providers/multimodal/audio-stt";
import { synthesizeViaRoute } from "@/lib/providers/multimodal/audio-tts";
import type { CallContext, ResolvedRoute } from "@/lib/providers/types";

const ctx: CallContext = { userId: "user-a", keyKind: null, source: "gateway" };
const route: ResolvedRoute = {
  modelName: "audio-model",
  upstreamModelName: "audio-upstream",
  protocol: "openai",
  provider: {
    id: "provider-a",
    name: "Provider A",
    protocol: "openai",
    baseUrl: "https://example.test/v1",
    apiKey: "AUDIO_SECRET",
    keys: [{ key: "AUDIO_SECRET", weight: 1 }],
    headers: { "x-custom-auth": "AUDIO_HEADER_SECRET" },
  },
  priority: 0,
  weight: 1,
  source: "byo",
  routeId: "route-a",
};

describe("multimodal audio adapter redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRoutesByCapability.mockResolvedValue([route]);
  });

  it("TTS 上游异常离开适配器前会移除 key/header 与原始 stack", async () => {
    vi.mocked(generateSpeech).mockRejectedValue(
      new Error("tts failed for AUDIO_SECRET and AUDIO_HEADER_SECRET"),
    );

    let caught: Error | undefined;
    try {
      await synthesizeViaRoute(ctx, "audio-model", { text: "hello" });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe("tts failed for [REDACTED] and [REDACTED]");
    expect(caught?.stack).not.toContain("AUDIO_SECRET");
    expect(caught?.stack).not.toContain("AUDIO_HEADER_SECRET");
  });

  it("STT 上游异常离开适配器前会移除 key/header 与原始 stack", async () => {
    vi.mocked(transcribe).mockRejectedValue(
      new Error("stt failed for AUDIO_SECRET and AUDIO_HEADER_SECRET"),
    );

    let caught: Error | undefined;
    try {
      await transcribeViaRoute(ctx, "audio-model", {
        audio: Buffer.from("audio"),
        mime: "audio/wav",
      });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe("stt failed for [REDACTED] and [REDACTED]");
    expect(caught?.stack).not.toContain("AUDIO_SECRET");
    expect(caught?.stack).not.toContain("AUDIO_HEADER_SECRET");
  });

  it("成功路径仍返回原有音频与转写结果", async () => {
    vi.mocked(generateSpeech).mockResolvedValue({
      audio: { uint8Array: new Uint8Array([1, 2, 3]) },
    } as never);
    vi.mocked(transcribe).mockResolvedValue({ text: "hello" } as never);

    const speech = await synthesizeViaRoute(ctx, "audio-model", { text: "hello" });
    const transcription = await transcribeViaRoute(ctx, "audio-model", {
      audio: Buffer.from("audio"),
      mime: "audio/wav",
    });

    expect([...speech.audioBuffer]).toEqual([1, 2, 3]);
    expect(speech.mime).toBe("audio/mpeg");
    expect(transcription.text).toBe("hello");
  });
});
