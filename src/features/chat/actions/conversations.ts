"use server";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/** 列出当前用户可见模型(全局 public ∪ 我的 BYO)。 */
export async function getVisibleModels() {
  const user = await requireSession();
  const db = await getDb();
  const [globals, byos] = await Promise.all([
    db
      .select()
      .from(S().globalModels)
      .where(and(eq(S().globalModels.accessScope, "public"), eq(S().globalModels.enabled, true)))
      .orderBy(S().globalModels.sortOrder),
    db
      .select({ model: S().userModels, providerName: S().userProviders.name })
      .from(S().userModels)
      .innerJoin(S().userProviders, eq(S().userModels.providerId, S().userProviders.id))
      .where(and(eq(S().userModels.userId, user.id), eq(S().userModels.enabled, true))),
  ]);
  return { globals: globals as Record<string, unknown>[], byos: byos as Record<string, unknown>[] };
}

/** 列出当前用户的会话。 */
export async function listConversations() {
  const user = await requireSession();
  const db = await getDb();
  return db
    .select()
    .from(S().conversations)
    .where(eq(S().conversations.userId, user.id))
    .orderBy(desc(S().conversations.updatedAt));
}

/** 创建新会话。 */
export async function createConversation(modelName?: string) {
  const user = await requireSession();
  const db = await getDb();
  const [row] = await db
    .insert(S().conversations)
    .values({ userId: user.id, title: "新会话", modelName: modelName ?? null })
    .returning({ id: S().conversations.id });
  revalidatePath("/chat", "layout");
  return row.id as string;
}

/** 删除会话。 */
export async function deleteConversation(id: string) {
  const user = await requireSession();
  const db = await getDb();
  // 确保属主
  const [conv] = await db
    .select({ userId: S().conversations.userId })
    .from(S().conversations)
    .where(eq(S().conversations.id, id))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.delete(S().conversations).where(eq(S().conversations.id, id));
  revalidatePath("/chat", "layout");
}

/** 重命名会话。 */
export async function renameConversation(id: string, title: string) {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select({ userId: S().conversations.userId })
    .from(S().conversations)
    .where(eq(S().conversations.id, id))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.update(S().conversations).set({ title, updatedAt: new Date() }).where(eq(S().conversations.id, id));
  revalidatePath("/chat", "layout");
}

/** 获取会话的消息(沿当前分支)。 */
export async function getMessages(conversationId: string) {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select()
    .from(S().conversations)
    .where(eq(S().conversations.id, conversationId))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("会话不存在或无权访问");

  return db
    .select()
    .from(S().messages)
    .where(eq(S().messages.conversationId, conversationId))
    .orderBy(S().messages.createdAt);
}

/** P1-B:查询会话的全部 artifact(按 messageId 分组)。 */
export async function getArtifactsByConversation(conversationId: string): Promise<Record<string, ArtifactRow[]>> {
  const user = await requireSession();
  const db = await getDb();
  const rows = await db
    .select()
    .from(S().artifacts)
    .where(eq(S().artifacts.conversationId, conversationId));
  // 按 messageId 分组
  const map: Record<string, ArtifactRow[]> = {};
  for (const r of rows as ArtifactRow[]) {
    if (r.userId !== user.id) continue; // 属主校验
    const key = r.messageId;
    (map[key] ??= []).push({
      id: r.id,
      messageId: r.messageId,
      userId: r.userId,
      kind: r.kind,
      title: r.title,
      language: r.language,
      content: r.content,
    });
  }
  return map;
}

interface ArtifactRow {
  id: string;
  messageId: string;
  userId: string;
  kind: string;
  title: string;
  language: string | null;
  content: string;
}
