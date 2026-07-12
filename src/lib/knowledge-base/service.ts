/**
 * 知识库服务 —— 多知识库 CRUD + 把 KB 内文件的 chunks 纳入 RAG 检索。
 *
 * 知识库是一组文件的逻辑分组(fileObjects.knowledgeBaseId 关联)。
 * 检索时按 knowledgeBaseIds 收集其下全部 ragReady 的 fileId,复用 retrieve。
 */
import { eq, and, inArray } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";
import { requireSession } from "@/lib/session";

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  fileCount: number;
}

/** 当前用户知识库列表的缓存键(per-user;用户写操作主动失效,TTL 兜底)。 */
const kbsKey = (userId: string) => `chat:kbs:${userId}`;

/** 列出当前用户的知识库(含文件数)。带 per-user 缓存。 */
export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const user = await requireSession();
  return cacheWrap(kbsKey(user.id), async () => {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const kbs = await db
      .select()
      .from(s.knowledgeBases)
      .where(eq(s.knowledgeBases.userId, user.id));
    // 逐个统计文件数(知识库数量通常不大)
    const result: KnowledgeBase[] = [];
    for (const kb of kbs as { id: string; name: string; description: string | null }[]) {
      const files = await db
        .select({ id: s.fileObjects.id })
        .from(s.fileObjects)
        .where(eq(s.fileObjects.knowledgeBaseId, kb.id));
      result.push({ id: kb.id, name: kb.name, description: kb.description, fileCount: files.length });
    }
    return result;
  });
}

/** 创建知识库。 */
export async function createKnowledgeBase(name: string, description?: string): Promise<string> {
  const user = await requireSession();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [row] = await db
    .insert(s.knowledgeBases)
    .values({ userId: user.id, name, description: description ?? null })
    .returning({ id: s.knowledgeBases.id });
  await cacheDel(kbsKey(user.id)).catch(() => {});
  return row.id as string;
}

/** 删除知识库(其下文件 knowledgeBaseId 置空,不删文件)。 */
export async function deleteKnowledgeBase(id: string): Promise<void> {
  const user = await requireSession();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [kb] = await db
    .select({ userId: s.knowledgeBases.userId })
    .from(s.knowledgeBases)
    .where(eq(s.knowledgeBases.id, id))
    .limit(1);
  if (!kb || kb.userId !== user.id) throw new Error("无权操作");
  // 解除文件关联
  await db.update(s.fileObjects).set({ knowledgeBaseId: null }).where(eq(s.fileObjects.knowledgeBaseId, id));
  await db.delete(s.knowledgeBases).where(eq(s.knowledgeBases.id, id));
  await cacheDel(kbsKey(user.id)).catch(() => {});
}

/** 把文件加入知识库。 */
export async function attachFileToKnowledgeBase(kbId: string, fileId: string): Promise<void> {
  const user = await requireSession();
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [kb] = await db
    .select({ userId: s.knowledgeBases.userId })
    .from(s.knowledgeBases)
    .where(eq(s.knowledgeBases.id, kbId))
    .limit(1);
  if (!kb || kb.userId !== user.id) throw new Error("无权操作");
  await db.update(s.fileObjects).set({ knowledgeBaseId: kbId }).where(and(eq(s.fileObjects.id, fileId), eq(s.fileObjects.userId, user.id)));
  await cacheDel(kbsKey(user.id)).catch(() => {});
}

/**
 * 收集知识库下全部 ragReady 文件的 fileId(供 retrieve 限定检索范围)。
 */
export async function getFileIdsByKnowledgeBases(kbIds: string[]): Promise<string[]> {
  if (kbIds.length === 0) return [];
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const rows = await db
    .select({ id: s.fileObjects.id })
    .from(s.fileObjects)
    .where(and(inArray(s.fileObjects.knowledgeBaseId, kbIds), eq(s.fileObjects.ragReady, true)));
  return rows.map((r: { id: string }) => r.id);
}
