/**
 * 记忆语义召回 —— 用当前查询向量在 user_memories.embedding 上检索相关 project 记忆。
 *
 * 三步策略(design §3):
 *   1. 融合向量检索:embed(query) 对 embed(content+disclosure) topK
 *   2. embedding 不可用 / 无结果 → query 分词命中 content/disclosure 关键词兜底
 *   3. 命中后异步刷新 lastAccessedAt(续命)
 *
 * project 过期过滤:lastAccessedAt > now-7d(design §3)。
 * preference/profile 走恒定注入(service.buildPreferencePrompt/buildProfilePrompt),不参与召回。
 *
 * PG: 用 pgvector `<=>` 余弦距离算子(DB 内计算)。
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { embedText } from "@/lib/rag/embedding";
import { distanceToSimilarity, DEFAULT_MIN_SIMILARITY, type Vector } from "@/lib/infra/vector";
import type { MemoryScope, UserMemory } from "./service";

const DEFAULT_RECALL_TOP_K = 5;
const DEDUP_SIMILARITY = 0.85; // 抽取去重阈值(高于召回阈值)
const PROJECT_EXPIRE_MS = 7 * 86400 * 1000;
/** 诊断:preference/profile 超 N 天未命中视为陈旧(project 过期已硬删,不在此)。 */
const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 86400 * 1000;

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  source: string;
  disclosure: string | null;
  embedding: Vector | string | null;
  lastAccessedAt: Date | null;
}

/**
 * 按查询语义召回 project 记忆(过期过滤 + 融合向量 + 关键词兜底)。
 * embedding 不可用或无结果时走关键词兜底。
 */
export async function recallMemories(
  userId: string,
  query: string,
  topK = DEFAULT_RECALL_TOP_K,
): Promise<UserMemory[]> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 1. 融合向量检索
  let queryVec: Vector | null = null;
  try {
    queryVec = await embedText(query);
  } catch {
    queryVec = null;
  }

  if (queryVec) {
    const vectorHits = await vectorRecall(db, s, userId, queryVec, topK);
    if (vectorHits.length > 0) {
      refreshLastAccessed(userId, vectorHits.map((m) => m.id)).catch(() => {});
      return vectorHits;
    }
  }

  // 2. 关键词兜底(embedding 不可用 或 无向量结果)
  const keywordHits = await keywordRecall(db, s, userId, query, topK);
  if (keywordHits.length > 0) {
    refreshLastAccessed(userId, keywordHits.map((m) => m.id)).catch(() => {});
  }
  return keywordHits;
}

/**
 * 查找与给定 embedding 最相似的记忆(抽取去重用)。
 * 同 userId + 同 scope,相似度 >= threshold 时返回最优匹配,否则 null。
 */
export async function findSimilarMemory(
  userId: string,
  embedding: Vector,
  scope: MemoryScope,
  threshold = DEDUP_SIMILARITY,
): Promise<UserMemory | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const rows = await db.execute(
    sql`SELECT id, scope, content, source, disclosure,
        (${s.userMemories.embedding} <=> ${JSON.stringify(embedding)}) AS distance
        FROM ${s.userMemories}
        WHERE ${s.userMemories.userId} = ${userId}
          AND ${s.userMemories.scope} = ${scope}
          AND ${s.userMemories.embedding} IS NOT NULL
        ORDER BY distance ASC
        LIMIT 1`,
  );
  const row = (rows.rows ?? rows)[0] as
    | { id: string; scope: string; content: string; source: string; disclosure: string | null; distance: number }
    | undefined;
  if (!row) return null;
  if (distanceToSimilarity(Number(row.distance)) < threshold) return null;
  return toUserMemory(row);
}

export interface MemoryDiagnostics {
  /** 疑似重复的记忆 id 集合(同 scope 内向量近邻 >= DEDUP_SIMILARITY)。 */
  duplicateIds: Set<string>;
  /** 陈旧的 preference/profile 记忆 id 集合(lastAccessedAt 超 STALE_DAYS 未命中)。 */
  staleIds: Set<string>;
}

/**
 * 记忆健康诊断(只读标记,不自动删)。
 *   - 重复疑似:同 userId + 同 scope 内 content 向量近邻 >= DEDUP_SIMILARITY 的成对记忆。
 *   - 陈旧:project 类 lastAccessedAt 超 STALE_MS 未命中(preference/profile 恒定注入,lastAccessedAt 不反映使用频率,不参与;project 1 周过期硬删,此处保留逻辑备未来调整)。
 *
 * 用于记忆管理页「健康检查」区,用户手动清理(复用现有 delete)。
 */
export async function getMemoryDiagnostics(userId: string): Promise<MemoryDiagnostics> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const rows = (await db
    .select({
      id: s.userMemories.id,
      scope: s.userMemories.scope,
      embedding: s.userMemories.embedding,
      lastAccessedAt: s.userMemories.lastAccessedAt,
    })
    .from(s.userMemories)
    .where(eq(s.userMemories.userId, userId))) as { id: string; scope: string; embedding: Vector | string | null; lastAccessedAt: Date | null }[];

  const duplicateIds = new Set<string>();
  const staleIds = new Set<string>();
  const now = Date.now();

  // 陈旧:project 超 STALE_MS 未命中(preference/profile 恒定注入,lastAccessedAt 不反映使用,不参与)
  for (const r of rows) {
    if (r.scope === "project" && r.lastAccessedAt && now - r.lastAccessedAt.getTime() > STALE_MS) {
      staleIds.add(r.id);
    }
  }

  // 重复疑似:同 scope 内向量近邻 >= 阈值(O(n²),记忆条数通常很小)
  const withEmb = rows
    .map((r) => ({ id: r.id, scope: r.scope, emb: normalizeEmbedding(r.embedding) }))
    .filter((r): r is { id: string; scope: string; emb: Vector } => r.emb !== null);
  for (let i = 0; i < withEmb.length; i++) {
    for (let j = i + 1; j < withEmb.length; j++) {
      if (withEmb[i].scope !== withEmb[j].scope) continue;
      if (cosineSimilarity(withEmb[i].emb, withEmb[j].emb) >= DEDUP_SIMILARITY) {
        duplicateIds.add(withEmb[i].id);
        duplicateIds.add(withEmb[j].id);
      }
    }
  }

  return { duplicateIds, staleIds };
}

// ---- 内部辅助 ----

/** 向量召回(project + 过期过滤)。PG DB 内 `<=>` 排序。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function vectorRecall(db: any, s: any, userId: string, queryVec: Vector, topK: number): Promise<UserMemory[]> {
  const rows = await db.execute(
    sql`SELECT id, scope, content, source, disclosure,
        (${s.userMemories.embedding} <=> ${JSON.stringify(queryVec)}) AS distance
        FROM ${s.userMemories}
        WHERE ${s.userMemories.userId} = ${userId}
          AND ${s.userMemories.scope} = 'project'
          AND ${s.userMemories.embedding} IS NOT NULL
          AND ${s.userMemories.lastAccessedAt} > NOW() - INTERVAL '7 days'
        ORDER BY distance ASC
        LIMIT ${topK}`,
  );
  const matched = (rows.rows ?? rows) as
    | { id: string; scope: string; content: string; source: string; disclosure: string | null; distance: number }[];
  return matched
    .filter((r) => distanceToSimilarity(Number(r.distance)) >= DEFAULT_MIN_SIMILARITY)
    .map((r) => toUserMemory(r));
}

/** 关键词兜底召回:query 分词命中 content/disclosure。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function keywordRecall(db: any, s: any, userId: string, query: string, topK: number): Promise<UserMemory[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const all = (await db
    .select({
      id: s.userMemories.id,
      scope: s.userMemories.scope,
      content: s.userMemories.content,
      source: s.userMemories.source,
      disclosure: s.userMemories.disclosure,
      lastAccessedAt: s.userMemories.lastAccessedAt,
    })
    .from(s.userMemories)
    .where(and(eq(s.userMemories.userId, userId), eq(s.userMemories.scope, "project")))) as MemoryRow[];

  const now = Date.now();
  const lowerTokens = tokens.map((t) => t.toLowerCase());
  const scored = all
    .filter((m) => !m.lastAccessedAt || now - m.lastAccessedAt.getTime() < PROJECT_EXPIRE_MS)
    .map((m) => {
      const text = `${m.content} ${m.disclosure ?? ""}`.toLowerCase();
      const hits = lowerTokens.filter((t) => text.includes(t)).length;
      return { row: m, score: hits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((x) => toUserMemory(x.row));
}

/** 异步刷新命中记忆的 lastAccessedAt(续命)。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function refreshLastAccessed(userId: string, ids: string[]): Promise<any> {
  if (ids.length === 0) return Promise.resolve();
  return (async () => {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    await db
      .update(s.userMemories)
      .set({ lastAccessedAt: new Date() })
      .where(and(eq(s.userMemories.userId, userId), inArray(s.userMemories.id, ids)));
  })();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUserMemory(row: any): UserMemory {
  return {
    id: row.id,
    scope: row.scope as UserMemory["scope"],
    content: row.content,
    source: (row.source ?? "manual") as UserMemory["source"],
    disclosure: row.disclosure ?? null,
  };
}

/** 简单分词:提取拉丁词(>=2 字符)和 CJK 字符段(>=2 字符)。 */
function tokenize(text: string): string[] {
  // 匹配拉丁字母词 或 连续 CJK 字符
  const matches = text.match(/[A-Za-z]{2,}|[一-鿿぀-ゟ゠-ヿ]{2,}/g);
  return matches ?? [];
}

/** 把 embedding 列值(pgvector 字符串)归一化为 Vector。null/非法返回 null。 */
function normalizeEmbedding(e: Vector | string | null): Vector | null {
  if (!e) return null;
  if (typeof e === "string") {
    try {
      return JSON.parse(e) as Vector;
    } catch {
      return null;
    }
  }
  return e as Vector;
}

/** 余弦相似度 [0,1]。 */
function cosineSimilarity(a: Vector, b: Vector): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
