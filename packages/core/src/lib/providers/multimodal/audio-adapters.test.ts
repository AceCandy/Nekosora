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
vi.mock("@/lib/gateway-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gateway-execution")>();
  return {
    ...actual,
    gatewayTelemetry: {
      startExecution: vi.fn(async () => undefined),
      recordAttempt: vi.fn(async () => undefined),
      finalizeExecution: vi.fn(async () => undefined),
    },
  };
});

import { generateSpeech, transcribe } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
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

function makeRoute(overrides: Partial<ResolvedRoute> = {}): ResolvedRoute {
  return {
    ...route,
    ...overrides,
    provider: {
      ...route.provider,
      ...overrides.provider,
    },
  };
}

describe("multimodal audio adapter redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateSpeech).mockReset();
    vi.mocked(transcribe).mockReset();
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

  it("TTS 首 key 可转移失败后使用同一 provider 的下一 key", async () => {
    mocks.resolveRoutesByCapability.mockResolvedValue([
      makeRoute({
        provider: {
          ...route.provider,
          apiKey: "AUDIO_KEY_A",
          keys: [
            { key: "AUDIO_KEY_A", weight: 1 },
            { key: "AUDIO_KEY_B", weight: 1 },
          ],
        },
      }),
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(generateSpeech)
      .mockRejectedValueOnce(Object.assign(new Error("temporary upstream failure"), {
        statusCode: 503,
      }))
      .mockResolvedValueOnce({ audio: { uint8Array: new Uint8Array([9]) } } as never);

    const result = await synthesizeViaRoute(ctx, "audio-model", { text: "hello" });

    expect([...result.audioBuffer]).toEqual([9]);
    expect(generateSpeech).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createOpenAI).mock.calls.map(([config]) => config?.apiKey)).toEqual([
      "AUDIO_KEY_A",
      "AUDIO_KEY_B",
    ]);
  });

  it("STT 首 key 可转移失败后使用同一 provider 的下一 key", async () => {
    mocks.resolveRoutesByCapability.mockResolvedValue([
      makeRoute({
        provider: {
          ...route.provider,
          apiKey: "AUDIO_KEY_A",
          keys: [
            { key: "AUDIO_KEY_A", weight: 1 },
            { key: "AUDIO_KEY_B", weight: 1 },
          ],
        },
      }),
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(transcribe)
      .mockRejectedValueOnce(Object.assign(new Error("temporary upstream failure"), {
        statusCode: 503,
      }))
      .mockResolvedValueOnce({ text: "fallback text" } as never);

    const result = await transcribeViaRoute(ctx, "audio-model", {
      audio: Buffer.from("audio"),
      mime: "audio/wav",
    });

    expect(result.text).toBe("fallback text");
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createOpenAI).mock.calls.map(([config]) => config?.apiKey)).toEqual([
      "AUDIO_KEY_A",
      "AUDIO_KEY_B",
    ]);
  });

  it.each([
    ["TTS", generateSpeech, () => synthesizeViaRoute(ctx, "audio-model", { text: "hello" })],
    ["STT", transcribe, () => transcribeViaRoute(ctx, "audio-model", {
      audio: Buffer.from("audio"),
      mime: "audio/wav",
    })],
  ] as const)("%s 首 route 可转移失败后使用下一 route", async (_name, operation, invoke) => {
    const fallbackRoute = makeRoute({
      routeId: "route-b",
      upstreamModelName: "audio-backup",
      priority: 1,
      provider: {
        ...route.provider,
        id: "provider-b",
        name: "Provider B",
        apiKey: "AUDIO_BACKUP_SECRET",
        keys: [{ key: "AUDIO_BACKUP_SECRET", weight: 1 }],
      },
    });
    mocks.resolveRoutesByCapability.mockResolvedValue([route, fallbackRoute]);
    vi.mocked(operation)
      .mockRejectedValueOnce(Object.assign(new Error("temporary upstream failure"), {
        statusCode: 503,
      }))
      .mockResolvedValueOnce(
        operation === generateSpeech
          ? { audio: { uint8Array: new Uint8Array([7]) } }
          : { text: "backup text" },
      );

    const result = await invoke();

    expect(result.providerName).toBe("Provider B");
    expect(result.routeId).toBe("route-b");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("TTS 不兼容的 route 不调用上游并继续使用兼容 route", async () => {
    const incompatibleRoute = makeRoute({
      protocol: "anthropic",
      provider: { ...route.provider, protocol: "anthropic" },
    });
    const fallbackRoute = makeRoute({
      routeId: "route-b",
      protocol: "openai-audio-tts",
      priority: 1,
      provider: {
        ...route.provider,
        id: "provider-b",
        name: "Provider B",
        protocol: "openai-audio-tts",
      },
    });
    mocks.resolveRoutesByCapability.mockResolvedValue([incompatibleRoute, fallbackRoute]);
    vi.mocked(generateSpeech).mockResolvedValue({
      audio: { uint8Array: new Uint8Array([5]) },
    } as never);

    const result = await synthesizeViaRoute(ctx, "audio-model", { text: "hello" });

    expect(result.providerName).toBe("Provider B");
    expect(result.routeId).toBe("route-b");
    expect(generateSpeech).toHaveBeenCalledTimes(1);
  });
});
