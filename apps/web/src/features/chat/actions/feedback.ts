"use server";

import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import {
  isFeedbackRating,
  isFeedbackReason,
  normalizeMessageFeedback,
  type FeedbackReason,
  type MessageFeedback,
} from "@/features/chat/model/feedback";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/** 越权 / 消息不存在 / 非 assistant 统一错误,不泄露消息存在性。 */
const DENIED = "无权操作";

/**
 * 写入或撤销当前用户对某条 assistant 消息的质量反馈。
 *
 * - rating=null:删除反馈,返回 null
 * - up:upsert,强制清空 reason
 * - down:upsert,reason 可选且可稍后更新
 * 不记录回答正文。
 */
export async function setMessageFeedback(
  messagePublicId: string,
  rating: "up" | "down" | null,
  reason: FeedbackReason | null = null,
): Promise<MessageFeedback | null> {
  const user = await requireSession();
  if (typeof messagePublicId !== "string" || messagePublicId.trim().length === 0) {
    throw new Error(DENIED);
  }

  const db = await getDb();
  const s = S();

  const [msg] = await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.publicId, messagePublicId))
    .limit(1);

  // 统一错误:缺失、已删除、跨会话、非属主、非 assistant 均不区分
  if (!msg || msg.deletedAt != null) throw new Error(DENIED);

  const [conv] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, msg.conversationId))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error(DENIED);
  if (msg.role !== "assistant") throw new Error(DENIED);

  if (rating === null) {
    await db
      .delete(s.messageFeedback)
      .where(
        and(
          eq(s.messageFeedback.userId, user.id),
          eq(s.messageFeedback.messageId, msg.id),
        ),
      );
    return null;
  }

  // 服务端再次校验枚举,不信任前端
  if (!isFeedbackRating(rating)) {
    throw new Error("非法反馈评分");
  }

  let storedReason: string | null = null;
  if (rating === "up") {
    storedReason = null;
  } else if (reason != null) {
    if (!isFeedbackReason(reason)) throw new Error("非法反馈原因");
    storedReason = reason;
  }

  const now = new Date();
  await db
    .insert(s.messageFeedback)
    .values({
      messageId: msg.id,
      conversationId: msg.conversationId,
      userId: user.id,
      rating,
      reason: storedReason,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [s.messageFeedback.userId, s.messageFeedback.messageId],
      set: {
        rating,
        reason: storedReason,
        updatedAt: now,
      },
    });

  return normalizeMessageFeedback(rating, storedReason) ?? null;
}
