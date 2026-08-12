import { describe, expect, it, vi } from "vitest";
import { estimateMessagesTokens } from "@/lib/tokens";
import {
  calculateChatReservation,
  countUnicodeCodePoints,
  measureSttSeconds,
  parseImageCount,
  parseTtsInput,
  settleChatUsage,
  settleReservedUsage,
} from "./metering";

describe("gateway governance metering", () => {
  it("reserves estimated Chat input plus the bounded output allowance", () => {
    const request = {
      model: "example",
      messages: [{ role: "user" as const, content: "hello" }],
      max_tokens: 8,
    };
    expect(calculateChatReservation(request, {
      contextWindow: 100,
      maxOutputTokens: 20,
    })).toBe(estimateMessagesTokens(request.messages) + 8);

    const withoutExplicitLimit = { ...request, max_tokens: undefined };
    expect(calculateChatReservation(withoutExplicitLimit, {
      contextWindow: 100,
      maxOutputTokens: 20,
    })).toBe(estimateMessagesTokens(request.messages) + 20);
  });

  it("uses reliable Chat usage and conservatively falls back to reservation", () => {
    expect(settleChatUsage(100, true, { totalTokens: 12 })).toBe(12);
    expect(settleChatUsage(100, true, { inputTokens: 8, outputTokens: 7 })).toBe(15);
    expect(settleChatUsage(100, true, { inputTokens: 8 })).toBe(100);
    expect(settleChatUsage(100, true, { totalTokens: Number.NaN })).toBe(100);
    expect(settleChatUsage(100, false, { totalTokens: 12 })).toBe(0);
  });

  it("strictly validates Image n without changing other image fields", () => {
    expect(parseImageCount(undefined)).toBe(1);
    expect(parseImageCount(1)).toBe(1);
    expect(parseImageCount(10)).toBe(10);
    for (const invalid of [0, 11, 1.5, "2", Number.NaN]) {
      expect(() => parseImageCount(invalid)).toThrow();
    }
  });

  it("counts TTS input by Unicode code point and shares the 4096 limit", () => {
    expect(countUnicodeCodePoints("A中😀")).toBe(3);
    expect(parseTtsInput("A中😀")).toEqual({ input: "A中😀", units: 3 });
    expect(parseTtsInput("😀".repeat(4_096)).units).toBe(4_096);
    expect(() => parseTtsInput("😀".repeat(4_097))).toThrow();
    expect(() => parseTtsInput("")).toThrow();
  });

  it("uses content metadata for STT duration and rounds up seconds", async () => {
    const parser = vi.fn().mockResolvedValue({
      format: { container: "WAVE", duration: 1.01 },
    });
    await expect(measureSttSeconds(Buffer.from("audio"), "image/png", parser)).resolves.toBe(2);
    expect(parser).toHaveBeenCalledWith(
      Buffer.from("audio"),
      { mimeType: "image/png" },
      { duration: true },
    );
  });

  it("rejects unsupported or unreliable STT metadata", async () => {
    for (const format of [
      { container: "ZIP", duration: 1 },
      { container: "AIFF", duration: 1 },
      { container: "AIFF-C", duration: 1 },
      { container: "MPEG", duration: 0 },
      { container: "MPEG", duration: Number.POSITIVE_INFINITY },
      { container: "MPEG" },
    ]) {
      await expect(measureSttSeconds(
        Buffer.from("audio"),
        "audio/mpeg",
        vi.fn().mockResolvedValue({ format }),
      )).rejects.toThrow();
    }
  });

  it("refunds before Provider start and settles reservation after start", () => {
    expect(settleReservedUsage(42, false)).toBe(0);
    expect(settleReservedUsage(42, true)).toBe(42);
  });
});
