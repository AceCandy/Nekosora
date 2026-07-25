import { describe, expect, it } from "vitest";
import {
  FEEDBACK_REASONS,
  isFeedbackRating,
  isFeedbackReason,
  normalizeMessageFeedback,
} from "./feedback";

describe("feedback 枚举与规范化", () => {
  it("固定原因集合完整", () => {
    expect(FEEDBACK_REASONS).toEqual([
      "incorrect",
      "irrelevant",
      "outdated",
      "unsafe",
      "other",
    ]);
  });

  it("识别合法 rating / reason", () => {
    expect(isFeedbackRating("up")).toBe(true);
    expect(isFeedbackRating("down")).toBe(true);
    expect(isFeedbackRating("meh")).toBe(false);
    expect(isFeedbackReason("incorrect")).toBe(true);
    expect(isFeedbackReason("spam")).toBe(false);
  });

  it("up 强制清空 reason", () => {
    expect(normalizeMessageFeedback("up", "incorrect")).toEqual({ rating: "up" });
  });

  it("down 保留合法 reason,丢弃非法", () => {
    expect(normalizeMessageFeedback("down", "outdated")).toEqual({
      rating: "down",
      reason: "outdated",
    });
    expect(normalizeMessageFeedback("down", "nope")).toEqual({ rating: "down" });
    expect(normalizeMessageFeedback("down", null)).toEqual({ rating: "down" });
  });

  it("非法 rating 返回 undefined(无反馈兼容)", () => {
    expect(normalizeMessageFeedback(null)).toBeUndefined();
    expect(normalizeMessageFeedback("sideways")).toBeUndefined();
  });
});
