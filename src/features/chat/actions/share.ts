"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import type {
  ConversationShareMessageSnapshot,
  ConversationShareMode,
  ConversationShareRenderStyleSnapshot,
  MessageVersionSelections,
} from "@/db/types";
import { resolveVisibleBranch } from "@/features/chat/lib/visible-branch";
import {
  createShareUnlockToken,
  fingerprintShareClient,
  getShareUnlockCookieName,
  hashSharePassword,
  verifySharePassword,
  verifyShareUnlockToken,
} from "@/features/chat/lib/share-security";
import {
  clearShareUnlockClientFailures,
  getShareUnlockRetryAfter,
  recordShareUnlockFailure,
} from "@/features/chat/lib/share-rate-limit";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";

const expirationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("forever") }),
  z.object({ kind: z.literal("days"), days: z.union([z.literal(1), z.literal(7), z.literal(30)]) }),
  z.object({ kind: z.literal("custom"), value: z.string().datetime() }),
]);

const createShareSchema = z.object({
  conversationId: z.string().min(1),
  mode: z.enum(["snapshot", "live"]),
  expiration: expirationSchema,
  password: z.string().min(8).max(128).optional(),
  renderStyleId: z.string().min(1).nullable().optional(),
}).superRefine((value, context) => {
  if (value.mode === "live" && value.renderStyleId) {
    context.addIssue({ code: "custom", path: ["renderStyleId"], message: "实时同步必须跟随会话样式" });
  }
  if (value.expiration.kind === "custom" && new Date(value.expiration.value).getTime() <= Date.now()) {
    context.addIssue({ code: "custom", path: ["expiration", "value"], message: "自定义到期时间必须晚于当前时间" });
  }
});

export type CreateShareInput = z.input<typeof createShareSchema>;

export interface ConversationShareListItem {
  shareId: string;
  mode: ConversationShareMode | "legacy";
  createdAt: Date;
  expiresAt: Date | null;
  status: "active" | "expired" | "revoked";
  hasPassword: boolean;
}

export type PublicShareState =
  | { status: "unavailable" }
  | { status: "locked" }
  | {
      status: "ready";
      title: string;
      model: string | null;
      messages: { role: string; content: string }[];
      renderStyle: ConversationShareRenderStyleSnapshot | null;
    };

export type UnlockShareResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "rate_limited"; retryAfter?: number };

interface CurrentShareMessage extends ConversationShareMessageSnapshot {
  deletedAt: Date | null;
}

// Drizzle 跨表动态 schema/query builder 的公共边界与项目数据库规范一致。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleBoundary = any;

function toExpiration(expiration: z.output<typeof expirationSchema>, now: Date): Date | null {
  if (expiration.kind === "forever") return null;
  if (expiration.kind === "custom") return new Date(expiration.value);
  return new Date(now.getTime() + expiration.days * 24 * 60 * 60 * 1000);
}

function toListItem(share: Record<string, unknown>, now: Date): ConversationShareListItem {
  const revoked = share.status !== "active" || Boolean(share.revokedAt);
  const expiresAt = share.expiresAt ? new Date(share.expiresAt as string | Date) : null;
  return {
    shareId: share.shareId as string,
    mode: (share.mode as ConversationShareMode | null) ?? "legacy",
    createdAt: new Date(share.createdAt as string | Date),
    expiresAt,
    status: revoked ? "revoked" : expiresAt && expiresAt <= now ? "expired" : "active",
    hasPassword: Boolean(share.passwordVerifier),
  };
}

function snapshotMessages(messages: Record<string, unknown>[]): ConversationShareMessageSnapshot[] {
  return messages.map((message) => ({
    publicId: message.publicId as string,
    role: message.role as string,
    content: message.content,
  }));
}

function normalizeMessages(messages: ConversationShareMessageSnapshot[]): { role: string; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
  }));
}

async function loadVisibleMessages(db: DrizzleBoundary, s: DrizzleBoundary, conversationId: string, selections: MessageVersionSelections | null) {
  const allMessages = await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt);
  return resolveVisibleBranch(allMessages as Record<string, unknown>[], selections).messages;
}

async function loadRenderStyleSnapshot(
  db: DrizzleBoundary,
  s: DrizzleBoundary,
  renderStyleId: string | null | undefined,
  strict = true,
): Promise<ConversationShareRenderStyleSnapshot | null> {
  if (!renderStyleId) return null;
  const [style] = await db
    .select()
    .from(s.renderStyles)
    .where(and(eq(s.renderStyles.id, renderStyleId), eq(s.renderStyles.enabled, true)))
    .limit(1);
  if (!style) {
    if (strict) throw new Error("输出样式不可用");
    return null;
  }
  return {
    sourceId: style.id,
    name: style.name,
    cssClass: style.cssClass,
    css: style.css,
    renderer: style.renderer === "custom" ? "custom" : "streamdown",
  };
}

/** 创建不可修改的分享记录；可见内容与样式全部由服务端派生。 */
export async function createShare(input: CreateShareInput): Promise<ConversationShareListItem> {
  const parsed = createShareSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "分享配置无效");
  const user = await requireSession();
  const db = await getDb();
  const s = getSchema() as DrizzleBoundary;
  const now = new Date();

  const [conversation] = await db.select().from(s.conversations)
    .where(eq(s.conversations.id, parsed.data.conversationId)).limit(1);
  if (!conversation || conversation.userId !== user.id) throw new Error("无权操作");

  const visibleMessages = await loadVisibleMessages(
    db,
    s,
    conversation.id,
    conversation.messageVersionSelections as MessageVersionSelections | null,
  );
  if (visibleMessages.length === 0) throw new Error("当前会话没有可分享内容");

  const selectedStyleId = parsed.data.mode === "snapshot"
    ? (parsed.data.renderStyleId === undefined ? conversation.renderStyleId : parsed.data.renderStyleId)
    : null;
  const renderStyleSnapshot = parsed.data.mode === "snapshot"
    ? await loadRenderStyleSnapshot(db, s, selectedStyleId)
    : null;
  const messageSnapshots = snapshotMessages(visibleMessages);
  const expiresAt = toExpiration(parsed.data.expiration, now);
  const passwordVerifier = parsed.data.password
    ? await hashSharePassword(parsed.data.password)
    : null;
  const shareId = crypto.randomUUID();

  await db.transaction(async (tx: DrizzleBoundary) => {
    await tx.insert(s.conversationShares).values({
      shareId,
      conversationId: conversation.id,
      status: "active",
      mode: parsed.data.mode,
      expiresAt,
      passwordVerifier,
      renderStyleSnapshot,
      titleSnapshot: conversation.title,
      modelSnapshot: conversation.modelName,
      messageIdsJson: messageSnapshots.map((message) => message.publicId),
      defaultMessageIdsJson: messageSnapshots.map((message) => message.publicId),
      messageSnapshotsJson: messageSnapshots,
    });
  });

  return {
    shareId,
    mode: parsed.data.mode,
    createdAt: now,
    expiresAt,
    status: "active",
    hasPassword: Boolean(passwordVerifier),
  };
}

/** 查询当前用户在指定会话创建的全部分享，不返回正文、CSS 或密码 verifier。 */
export async function listConversationShares(conversationId: string): Promise<ConversationShareListItem[]> {
  const user = await requireSession();
  const db = await getDb();
  const s = getSchema() as DrizzleBoundary;
  const [conversation] = await db.select().from(s.conversations)
    .where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.userId !== user.id) throw new Error("无权操作");
  const rows = await db.select({
    shareId: s.conversationShares.shareId,
    mode: s.conversationShares.mode,
    status: s.conversationShares.status,
    expiresAt: s.conversationShares.expiresAt,
    passwordVerifier: s.conversationShares.passwordVerifier,
    revokedAt: s.conversationShares.revokedAt,
    createdAt: s.conversationShares.createdAt,
  }).from(s.conversationShares)
    .where(eq(s.conversationShares.conversationId, conversationId))
    .orderBy(s.conversationShares.createdAt);
  return (rows as Record<string, unknown>[]).map((share) => toListItem(share, new Date())).reverse();
}

async function loadLegacyMessages(db: DrizzleBoundary, s: DrizzleBoundary, share: Record<string, unknown>) {
  const messageIds = (share.messageIdsJson ?? []) as string[];
  if (messageIds.length === 0) return [];
  const allMessages = await db.select({
    publicId: s.messages.publicId,
    role: s.messages.role,
    content: s.messages.content,
    deletedAt: s.messages.deletedAt,
  }).from(s.messages).where(and(
    eq(s.messages.conversationId, share.conversationId),
    inArray(s.messages.publicId, messageIds),
  ));
  const current = allMessages as CurrentShareMessage[];
  const byPublicId = new Map(current.map((message) => [message.publicId, message]));
  const snapshots = share.messageSnapshotsJson as ConversationShareMessageSnapshot[] | null;
  return snapshots
    ? snapshots.filter((message) => !byPublicId.get(message.publicId)?.deletedAt)
    : messageIds.map((id) => byPublicId.get(id)).filter((message): message is CurrentShareMessage => Boolean(message && !message.deletedAt));
}

/** 公开读取；锁定与不可用状态永不携带私密元数据。 */
export async function getShare(shareId: string): Promise<PublicShareState> {
  const db = await getDb();
  const s = getSchema() as DrizzleBoundary;
  const [share] = await db.select().from(s.conversationShares)
    .where(eq(s.conversationShares.shareId, shareId)).limit(1);
  const now = new Date();
  if (!share || share.status !== "active" || share.revokedAt || (share.expiresAt && new Date(share.expiresAt) <= now)) {
    return { status: "unavailable" };
  }

  if (share.passwordVerifier) {
    const cookieStore = await cookies();
    const token = cookieStore.get(getShareUnlockCookieName(shareId))?.value;
    if (!verifyShareUnlockToken(token, shareId, now)) return { status: "locked" };
  }

  let title = share.titleSnapshot ?? "分享的对话";
  let model = share.modelSnapshot ?? null;
  let renderStyle = (share.renderStyleSnapshot ?? null) as ConversationShareRenderStyleSnapshot | null;
  let messages: ConversationShareMessageSnapshot[];

  if (share.mode === "live") {
    const [conversation] = await db.select().from(s.conversations)
      .where(eq(s.conversations.id, share.conversationId)).limit(1);
    if (!conversation) return { status: "unavailable" };
    title = conversation.title;
    model = conversation.modelName;
    messages = snapshotMessages(await loadVisibleMessages(
      db,
      s,
      conversation.id,
      conversation.messageVersionSelections as MessageVersionSelections | null,
    ));
    renderStyle = await loadRenderStyleSnapshot(db, s, conversation.renderStyleId, false);
  } else if (share.mode === "snapshot") {
    messages = (share.messageSnapshotsJson ?? []) as ConversationShareMessageSnapshot[];
  } else {
    messages = await loadLegacyMessages(db, s, share);
    renderStyle = null;
  }

  try {
    await db.update(s.conversationShares).set({ lastAccessedAt: now })
      .where(eq(s.conversationShares.shareId, shareId));
  } catch { /* best effort */ }

  return { status: "ready", title, model, messages: normalizeMessages(messages), renderStyle };
}

function clientSource(requestHeaders: Headers): string {
  return requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    || requestHeaders.get("x-real-ip")?.trim()
    || "unknown";
}

/** 校验访问密码并签发当前分享专属 HttpOnly Cookie。 */
export async function unlockShare(shareId: string, password: string): Promise<UnlockShareResult> {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { ok: false, reason: "invalid" };
  }
  const db = await getDb();
  const s = getSchema() as DrizzleBoundary;
  const now = new Date();
  const [share] = await db.select().from(s.conversationShares)
    .where(eq(s.conversationShares.shareId, shareId)).limit(1);
  if (!share || share.status !== "active" || share.revokedAt || !share.passwordVerifier ||
    (share.expiresAt && new Date(share.expiresAt) <= now)) {
    return { ok: false, reason: "invalid" };
  }

  const requestHeaders = await headers();
  const fingerprint = fingerprintShareClient(clientSource(requestHeaders));
  const retryAfter = await getShareUnlockRetryAfter(db, shareId, fingerprint, now);
  if (retryAfter !== null) return { ok: false, reason: "rate_limited", retryAfter };

  if (!await verifySharePassword(password, share.passwordVerifier)) {
    await recordShareUnlockFailure(db, shareId, fingerprint, now);
    return { ok: false, reason: "invalid" };
  }

  await clearShareUnlockClientFailures(db, shareId, fingerprint);
  const expiresAt = share.expiresAt ? new Date(share.expiresAt) : null;
  const unlock = createShareUnlockToken(shareId, expiresAt, now);
  const cookieStore = await cookies();
  cookieStore.set(getShareUnlockCookieName(shareId), unlock.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/share/${shareId}`,
    expires: unlock.expiresAt,
  });
  return { ok: true };
}

/** 撤销分享；配置仍保留以供当前会话列表显示历史状态。 */
export async function revokeShare(shareId: string): Promise<void> {
  const user = await requireSession();
  const db = await getDb();
  const s = getSchema() as DrizzleBoundary;
  const [share] = await db.select().from(s.conversationShares)
    .where(eq(s.conversationShares.shareId, shareId)).limit(1);
  if (!share) throw new Error("分享不存在");
  const [conversation] = await db.select().from(s.conversations)
    .where(eq(s.conversations.id, share.conversationId)).limit(1);
  if (!conversation || conversation.userId !== user.id) throw new Error("无权操作");
  if (share.status === "revoked" || share.revokedAt) return;
  await db.update(s.conversationShares).set({ revokedAt: new Date(), status: "revoked" })
    .where(eq(s.conversationShares.shareId, shareId));
}
