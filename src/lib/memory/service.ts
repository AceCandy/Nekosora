/**
 * 长期记忆服务 —— 跨会话的用户偏好/画像/项目记忆。
 *
 * 三分类(design §1):
 *   - preference:用户偏好(恒定注入,cap 400 字)
 *   - profile:用户身份/事实(恒定注入,top N)
 *   - project:在做的事(召回注入,1 周过期硬删)
 *
 * 读时缓存(60s),写入后主动失效(design §6)。
 */
import { eq, and, sql } from "drizzle-orm";
import { getDb, getSchema, isPg } from "@/lib/infra/db";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";

const PREFERENCE_CAP_CHARS = 400;
const PROJECT_EXPIRE_DAYS = 7;
const PROJECT_EXPIRE_SECONDS = PROJECT_EXPIRE_DAYS * 86400;

export type MemoryScope = "preference" | "profile" | "project";
export type MemorySource = "manual" | "ai";

export interface UserMemory {
  id: string;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  disclosure?: string | null;
  priority?: number;
  lastAccessedAt?: Date | null;
  createdAt?: Date | null;
}

/** scope → 默认 priority(design §1:preference=0/profile=1/project=2)。 */
export function defaultPriorityForScope(scope: MemoryScope): number {
  return scope === "profile" ? 1 : scope === "project" ? 2 : 0;
}

/**
 * 清理过期的 project 记忆(1 周未访问硬删)。
 * 在 getMemories / extractMemories 入口懒触发(design §2)。
 */
export async function purgeExpiredProjectMemories(userId: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  if (isPg) {
    await db.execute(
      sql`DELETE FROM ${s.userMemories} WHERE ${s.userMemories.userId} = ${userId} AND ${s.userMemories.scope} = 'project' AND ${s.userMemories.lastAccessedAt} < NOW() - INTERVAL '7 days'`,
    );
  } else {
    await db.execute(
      sql`DELETE FROM ${s.userMemories} WHERE ${s.userMemories.userId} = ${userId} AND ${s.userMemories.scope} = 'project' AND ${s.userMemories.lastAccessedAt} < unixepoch() - ${PROJECT_EXPIRE_SECONDS}`,
    );
  }
}

/** 读取用户全部记忆(带 60s 缓存)。入口触发 project 过期懒清理。 */
export async function getMemories(userId: string): Promise<UserMemory[]> {
  await purgeExpiredProjectMemories(userId).catch(() => {});
  return cacheWrap(
    `memories:${userId}`,
    async () => {
      const db = await getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = getSchema() as any;
      const rows = await db
        .select({
          id: s.userMemories.id,
          scope: s.userMemories.scope,
          content: s.userMemories.content,
          source: s.userMemories.source,
          disclosure: s.userMemories.disclosure,
          priority: s.userMemories.priority,
          lastAccessedAt: s.userMemories.lastAccessedAt,
          createdAt: s.userMemories.createdAt,
        })
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
  await db.insert(s.userMemories).values({
    userId,
    scope,
    content,
    source: "manual",
    priority: defaultPriorityForScope(scope),
    lastAccessedAt: new Date(),
  });
  await invalidateMemoryCache(userId);
}

/** 更新记忆内容(重新生成 embedding,刷新 lastAccessedAt)。 */
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
    .set({ content, embedding, lastAccessedAt: new Date() })
    .where(and(eq(s.userMemories.id, memoryId), eq(s.userMemories.userId, userId)));
  await invalidateMemoryCache(userId);
}

/** 删除记忆。 */
export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.delete(s.userMemories).where(and(eq(s.userMemories.id, memoryId), eq(s.userMemories.userId, userId)));
  await invalidateMemoryCache(userId);
}

/** 清空记忆:scope 缺省清空全部,传 scope 只清该分类。 */
export async function clearMemories(userId: string, scope?: MemoryScope): Promise<void> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  if (scope) {
    await db.delete(s.userMemories).where(and(eq(s.userMemories.userId, userId), eq(s.userMemories.scope, scope)));
  } else {
    await db.delete(s.userMemories).where(eq(s.userMemories.userId, userId));
  }
  await invalidateMemoryCache(userId);
}

/** 使记忆缓存失效(增删改 + 抽取后调用)。 */
export async function invalidateMemoryCache(userId: string): Promise<void> {
  await cacheDel(`memories:${userId}`).catch(() => {});
}

/** 构造 preference 槽位文本(cap 400 字)。 */
export function buildPreferencePrompt(memories: UserMemory[]): string {
  const prefs = memories.filter((m) => m.scope === "preference").map((m) => m.content);
  if (prefs.length === 0) return "";
  const joined = prefs.join("; ");
  return joined.slice(0, PREFERENCE_CAP_CHARS);
}

/** 构造 profile 槽位文本(恒定注入,限量 top N)。 */
export function buildProfilePrompt(memories: UserMemory[], maxItems = 5): string {
  const items = memories.filter((m) => m.scope === "profile").slice(0, maxItems);
  if (items.length === 0) return "";
  return items.map((m) => `- ${m.content}`).join("\n");
}

/** 构造 project 召回槽位文本(按给定条数限制)。 */
export function buildProjectPrompt(memories: UserMemory[], maxItems = 5): string {
  if (memories.length === 0) return "";
  return memories.slice(0, maxItems).map((m) => `- ${m.content}`).join("\n");
}
