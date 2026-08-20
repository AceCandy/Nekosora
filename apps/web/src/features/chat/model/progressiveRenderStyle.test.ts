import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/features/chat/model/types";
import {
  applyRenderStyleBatch,
  resolveRenderStyle,
  resolveViewportAnchorDelta,
  sameRenderStyle,
  settleRenderStyleRollout,
  startRenderStyleRollout,
  type RenderStyleRollout,
  type RenderStyleSemantics,
} from "./progressiveRenderStyle";

const DEFAULT: RenderStyleSemantics = {
  cssClass: null,
  renderer: undefined,
  isPaper: undefined,
};
const PAPER: RenderStyleSemantics = {
  cssClass: "paper",
  renderer: "custom",
  isPaper: true,
};
const messages: ChatMessage[] = [
  { role: "user", content: "q1", publicId: "u1" },
  { role: "assistant", content: "a1", publicId: "a1" },
  { role: "user", content: "q2", publicId: "u2" },
  { role: "assistant", content: "a2", publicId: "a2" },
  { role: "assistant", content: "a3", publicId: "a3" },
];

function settled(target: RenderStyleSemantics): RenderStyleRollout {
  return {
    conversationId: "conversation-1",
    target,
    applied: null,
    generation: 0,
  };
}

describe("progressive render style rollout", () => {
  it("switches visible assistants first, then converges in batches", () => {
    const started = startRenderStyleRollout(
      settled(DEFAULT),
      PAPER,
      messages,
      new Set([3]),
      1,
      "conversation-1",
    );

    expect(resolveRenderStyle(started, 1)).toBe(DEFAULT);
    expect(resolveRenderStyle(started, 3)).toBe(PAPER);
    expect(resolveRenderStyle(started, 4)).toBe(DEFAULT);
    expect(started.applied?.has(0)).toBe(false);
    expect(started.applied?.has(2)).toBe(false);
    expect(resolveRenderStyle(started, 5)).toBe(PAPER);

    const batched = applyRenderStyleBatch(started, [4, 1], 1);
    expect(resolveRenderStyle(batched, 1)).toBe(PAPER);
    expect(resolveRenderStyle(batched, 4)).toBe(PAPER);
    expect(settleRenderStyleRollout(batched, 1).applied).toBeNull();
  });

  it("treats CSS-only changes as a rollout boundary", () => {
    const alternate = { ...DEFAULT, cssClass: "alternate" };
    expect(sameRenderStyle(DEFAULT, alternate)).toBe(false);

    const started = startRenderStyleRollout(
      settled(DEFAULT),
      alternate,
      messages,
      new Set([3]),
      1,
      "conversation-1",
    );
    expect(resolveRenderStyle(started, 3)).toBe(alternate);
    expect(resolveRenderStyle(started, 1)).toBe(DEFAULT);
  });

  it("ignores stale batches after a rapid second switch", () => {
    const first = applyRenderStyleBatch(
      startRenderStyleRollout(
        settled(DEFAULT),
        PAPER,
        messages,
        new Set([3]),
        1,
        "conversation-1",
      ),
      [4],
      1,
    );
    const second = startRenderStyleRollout(
      first,
      DEFAULT,
      messages,
      new Set([1]),
      2,
      "conversation-1",
    );

    const stale = applyRenderStyleBatch(second, [3, 4], 1);
    expect(stale).toBe(second);
    expect(settleRenderStyleRollout(stale, 1)).toBe(stale);
    expect(resolveRenderStyle(stale, 1)).toBe(DEFAULT);
    expect(resolveRenderStyle(stale, 3)).toBe(PAPER);

    const finished = settleRenderStyleRollout(
      applyRenderStyleBatch(second, [3, 4], 2),
      2,
    );
    expect(resolveRenderStyle(finished, 1)).toBe(DEFAULT);
    expect(resolveRenderStyle(finished, 3)).toBe(DEFAULT);
    expect(resolveRenderStyle(finished, 4)).toBe(DEFAULT);
  });

  it("computes the scrollTop correction needed to preserve a message offset", () => {
    expect(resolveViewportAnchorDelta(-120, 48, 320, 320)).toBe(168);
    expect(resolveViewportAnchorDelta(64, 63.6, 320, 320)).toBe(0);
    expect(resolveViewportAnchorDelta(-120, 48, 320, 360)).toBe(0);
  });
});
