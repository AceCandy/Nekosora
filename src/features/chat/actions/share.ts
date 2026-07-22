"use server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";

/** 创建分享(拍快照:当前消息 ID 列表 + 标题/模型)。返回 shareId。 */
export async function createShare(conversationId: string): Promise<string> {
  const user = await requireSession();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 校验属主
  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");

  // 拍快照:当前消息 publicId 列表
  const msgs = await db
    .select({ publicId: s.messages.publicId })
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)));
  const messageIds = (msgs as { publicId: string }[]).map((m) => m.publicId);

  const shareId = crypto.randomUUID();
  await db.insert(s.conversationShares).values({
    shareId,
    conversationId,
    status: "active",
    titleSnapshot: conv.title,
    modelSnapshot: conv.modelName,
    messageIdsJson: messageIds,
    defaultMessageIdsJson: messageIds,
  });
  return shareId;
}

/** 读取分享内容(公开,无需登录)。 */
export async function getShare(shareId: string): Promise<{
  title: string;
  model: string | null;
  messages: { role: string; content: string }[];
} | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const [share] = await db.select().from(s.conversationShares).where(eq(s.conversationShares.shareId, shareId)).limit(1);
  if (!share || share.status !== "active" || share.revokedAt) return null;

  const messageIds = (share.messageIdsJson ?? []) as string[];
  if (messageIds.length === 0) return null;

  // 取这些消息(按顺序)
  const allMsgs = await db.select().from(s.messages).where(eq(s.messages.conversationId, share.conversationId));
  const byPublicId = new Map((allMsgs as { publicId: string; role: string; content: string }[]).map((m) => [m.publicId, m]));
  const ordered = messageIds
    .map((id) => byPublicId.get(id))
    .filter((m): m is { publicId: string; role: string; content: string } => !!m)
    .map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content) }));

  // 更新最后访问时间(失败忽略)
  try {
    await db.update(s.conversationShares).set({ lastAccessedAt: new Date() }).where(eq(s.conversationShares.shareId, shareId));
  } catch { /* ignore */ }

  return {
    title: share.titleSnapshot ?? "分享的对话",
    model: share.modelSnapshot ?? null,
    messages: ordered,
  };
}

/** 撤销分享(需登录鉴权)。 */
export async function revokeShare(shareId: string): Promise<void> {
  const user = await requireSession();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const [share] = await db.select().from(s.conversationShares).where(eq(s.conversationShares.shareId, shareId)).limit(1);
  if (!share) throw new Error("分享不存在");

  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, share.conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");

  await db.update(s.conversationShares).set({ revokedAt: new Date(), status: "revoked" }).where(eq(s.conversationShares.shareId, shareId));
}
