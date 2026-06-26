/**
 * 长期记忆服务 —— 跨会话的用户偏好/画像记忆。
 *
 * 借鉴 DEEIX-Chat:
 *   - scope:preference(注入 SlotPreference,cap 400 字)/ profile / custom(相关性 top-N)
 *   - 读时缓存(避免每条消息查库)
 *   - 语义召回(复用 embedding)可选,200ms 超时优雅跳过
 *
 * 简化版:不做语义召回(复用 RAG infra 留作扩展),按 scope 直接取。
 */
import { eq, and } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { cacheWrap } from "@/lib/infra/cache";

const PREFERENCE_CAP_CHARS = 400;

export type MemoryScope = "preference" | "profile" | "custom";
export type MemorySource = "manual" | "ai";

export interface UserMemory {
  id: string;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
}

/** 读取用户全部记忆(带 60s 缓存)。 */
export async function getMemories(userId: string): Promise<UserMemory[]> {
  return cacheWrap(
    `memories:${userId}`,
    async () => {
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      const rows = await db
        .select({ id: s.userMemories.id, scope: s.userMemories.scope, content: s.userMemories.content, source: s.userMemories.source })
        .from(s.userMemories)
        .where(eq(s.userMemories.userId, userId));
      return rows as UserMemory[];
    },
    60_000,
  );
}

/** 添加一条记忆(手动来源)。 */
export async function addMemory(userId: string, scope: MemoryScope, content: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.insert(s.userMemories).values({ userId, scope, content, source: "manual" });
}

/** 更新记忆内容(重新生成 embedding)。 */
export async function updateMemory(userId: string, memoryId: string, content: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  let embedding = null;
  try {
    const { embedText } = await import("@/lib/rag/embedding");
    embedding = await embedText(content);
  } catch {
    /* embedding 不可用时置空 */
  }
  await db
    .update(s.userMemories)
    .set({ content, embedding })
    .where(and(eq(s.userMemories.id, memoryId), eq(s.userMemories.userId, userId)));
}

/** 删除记忆。 */
export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.delete(s.userMemories).where(and(eq(s.userMemories.id, memoryId), eq(s.userMemories.userId, userId)));
}

/** 构造 preference 槽位文本(cap 400 字)。 */
export function buildPreferencePrompt(memories: UserMemory[]): string {
  const prefs = memories.filter((m) => m.scope === "preference").map((m) => m.content);
  if (prefs.length === 0) return "";
  const joined = prefs.join("; ");
  return joined.slice(0, PREFERENCE_CAP_CHARS);
}

/** 构造 profile/custom 槽位文本(按给定条数限制)。 */
export function buildProfilePrompt(memories: UserMemory[], maxItems = 5): string {
  const items = memories.filter((m) => m.scope === "profile" || m.scope === "custom").slice(0, maxItems);
  if (items.length === 0) return "";
  return items.map((m) => `- ${m.content}`).join("\n");
}
