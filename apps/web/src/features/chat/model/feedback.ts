/**
 * 回答质量反馈 —— 固定枚举与规范化。
 * 服务端写入与历史回填共用,避免前后端各写一份校验。
 */

export const FEEDBACK_REASONS = [
  "incorrect",
  "irrelevant",
  "outdated",
  "unsafe",
  "other",
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export type FeedbackRating = "up" | "down";

/** 当前用户对某条 assistant 消息的反馈(无记录时不出现此字段)。 */
export type MessageFeedback = {
  rating: FeedbackRating;
  reason?: FeedbackReason;
};

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return typeof value === "string" && (FEEDBACK_REASONS as readonly string[]).includes(value);
}

export function isFeedbackRating(value: unknown): value is FeedbackRating {
  return value === "up" || value === "down";
}

/**
 * 将 DB/客户端输入规范为 UI 可用的 feedback。
 * - rating 非法 → undefined
 * - up 强制不带 reason
 * - down 仅保留合法 reason
 */
export function normalizeMessageFeedback(
  rating: unknown,
  reason?: unknown,
): MessageFeedback | undefined {
  if (!isFeedbackRating(rating)) return undefined;
  if (rating === "up") return { rating: "up" };
  const out: MessageFeedback = { rating: "down" };
  if (isFeedbackReason(reason)) out.reason = reason;
  return out;
}
