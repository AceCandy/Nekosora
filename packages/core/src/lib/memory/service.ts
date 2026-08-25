/**
 * 长期记忆服务 -- 跨会话的用户偏好/画像/项目记忆(基于 mem0)。
 *
 * 三分类(design §1):
 *   - preference:用户偏好(恒定注入,cap 400 字)
 *   - profile:用户身份/事实(恒定注入,top N)
 *   - project:在做的事(召回注入,M-4 用 mem0 expirationDate 过期)
 *
 * 存储/检索/抽取由 mem0 承担;本文件负责 CRUD 适配 + 槽位构造 + 缓存。
 * 读时缓存(60s),写入后主动失效(design §6)。
 */
import { getMemory } from "./mem0";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";

const PREFERENCE_CAP_CHARS = 400;

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

/** 将 mem0 或缓存返回的日期值收敛为有效 Date。 */
export function toMemoryDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** scope -> 默认 priority(design §1:preference=0/profile=1/project=2)。 */
export function defaultPriorityForScope(scope: MemoryScope): number {
  return scope === "profile" ? 1 : scope === "project" ? 2 : 0;
}

const PROJECT_EXPIRE_DAYS = 7;

/** project 记忆的过期日期(YYYY-MM-DD,M-4 用 mem0 expirationDate 过滤 + 懒硬删)。 */
export function toProjectExpirationDate(): string {
  return new Date(Date.now() + PROJECT_EXPIRE_DAYS * 86400 * 1000).toISOString().slice(0, 10);
}

/** 读取用户全部记忆(带 60s 缓存)。缓存未命中时过滤并尽力清理过期 project 记忆。 */
export async function getMemories(userId: string): Promise<UserMemory[]> {
  const memories = await cacheWrap(
    `memories:${userId}`,
    async () => {
      try {
        const memory = await getMemory();
        const res = await memory.getAll({ filters: { user_id: userId }, showExpired: true });
        const today = new Date().toISOString().slice(0, 10);
        const expiredIds: string[] = [];
        const active = (res.results ?? []).filter((item) => {
          const expirationDate = item.metadata?.expirationDate;
          const expired = item.metadata?.scope === "project"
            && typeof expirationDate === "string"
            && expirationDate < today;
          if (expired) expiredIds.push(item.id);
          return !expired;
        });
        await Promise.allSettled(expiredIds.map((id) => memory.delete(id)));
        return active.map(toUserMemory);
      } catch {
        return [];
      }
    },
    60_000,
  );
  // Keyv 会把 Date 序列化为字符串，缓存出口需恢复领域类型。
  return memories.map((memory) => ({ ...memory, createdAt: toMemoryDate(memory.createdAt) }));
}

/** 添加一条记忆(手动来源,infer=false 直接存原文;project 设 7 天过期)。 */
export async function addMemory(userId: string, scope: MemoryScope, content: string): Promise<void> {
  const memory = await getMemory();
  const isProject = scope === "project";
  const expirationDate = isProject ? toProjectExpirationDate() : null;
  await memory.add(content, {
    userId,
    infer: false,
    expirationDate,
    metadata: {
      scope,
      source: "manual",
      priority: defaultPriorityForScope(scope),
      ...(isProject ? { expirationDate } : {}),
    },
  });
  await invalidateMemoryCache(userId);
}

/** 更新记忆内容。 */
export async function updateMemory(userId: string, memoryId: string, content: string): Promise<void> {
  const memory = await getMemory();
  await memory.update(memoryId, { text: content });
  await invalidateMemoryCache(userId);
}

/** 删除记忆。 */
export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  const memory = await getMemory();
  await memory.delete(memoryId);
  await invalidateMemoryCache(userId);
}

/** 清空记忆:scope 缺省清空全部,传 scope 只清该分类。 */
export async function clearMemories(userId: string, scope?: MemoryScope): Promise<void> {
  const memory = await getMemory();
  if (scope) {
    // deleteAll 仅按 userId,不支持 scope;getAll + 逐个 delete
    const res = await memory.getAll({ filters: { user_id: userId, scope } });
    await Promise.all((res.results ?? []).map((m) => memory.delete(m.id)));
  } else {
    await memory.deleteAll({ userId });
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

/** mem0 MemoryItem -> UserMemory(metadata 承载 scope/source/disclosure/priority)。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toUserMemory(item: any): UserMemory {
  const meta = item.metadata ?? {};
  return {
    id: item.id,
    scope: (meta.scope as MemoryScope) ?? "project",
    content: item.memory,
    source: (meta.source as MemorySource) ?? "manual",
    disclosure: (meta.disclosure as string | null) ?? null,
    priority: typeof meta.priority === "number" ? meta.priority : undefined,
    createdAt: toMemoryDate(item.createdAt),
  };
}
