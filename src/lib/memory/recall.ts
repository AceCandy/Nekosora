/**
 * 记忆语义召回 —— 用当前查询向量在 user_memories.embedding 上检索相关记忆。
 *
 * PG: 用 pgvector `<=>` 余弦距离算子(DB 内计算)。
 * SQLite: 取全部记忆的 embedding 在内存算余弦相似度(记忆条数通常很小)。
 *
 * 返回 top-K 相关记忆(排除 preference,preference 仍走全量注入)。
 */
import { eq, and, sql } from "drizzle-orm";
import { getDb, getSchema, isPg } from "@/lib/infra/db";
import { embedText } from "@/lib/rag/embedding";
import { distanceToSimilarity, DEFAULT_MIN_SIMILARITY, type Vector } from "@/lib/infra/vector";
import type { UserMemory } from "./service";

const DEFAULT_RECALL_TOP_K = 5;

interface MemoryRow {
  id: string;
  scope: string;
  content: string;
  source: string;
  embedding: Vector | string | null;
}

/**
 * 按查询语义召回 profile/custom 记忆(preference 不参与召回,走全量)。
 * embedding 不可用时返回空数组(调用方应回退到全量 profile)。
 */
export async function recallMemories(
  userId: string,
  query: string,
  topK = DEFAULT_RECALL_TOP_K,
): Promise<UserMemory[]> {
  let queryVec: Vector;
  try {
    queryVec = await embedText(query);
  } catch {
    return []; // embedding 不可用,回退全量
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  if (isPg) {
    // PG:用 pgvector 余弦距离算子在 DB 内排序
    const rows = await db.execute(
      sql`SELECT id, scope, content, source,
          (${s.userMemories.embedding} <=> ${JSON.stringify(queryVec)}) AS distance
          FROM ${s.userMemories}
          WHERE ${s.userMemories.userId} = ${userId}
            AND ${s.userMemories.scope} IN ('profile', 'custom')
            AND ${s.userMemories.embedding} IS NOT NULL
          ORDER BY distance ASC
          LIMIT ${topK}`,
    );
    const matched = (rows.rows ?? rows) as { id: string; scope: string; content: string; source: string; distance: number }[];
    return matched
      .filter((r) => distanceToSimilarity(Number(r.distance)) >= DEFAULT_MIN_SIMILARITY)
      .map((r) => ({ id: r.id, scope: r.scope as UserMemory["scope"], content: r.content, source: (r.source ?? "manual") as UserMemory["source"] }));
  }

  // SQLite:内存余弦(记忆量小)
  const all = (await db
    .select({ id: s.userMemories.id, scope: s.userMemories.scope, content: s.userMemories.content, source: s.userMemories.source, embedding: s.userMemories.embedding })
    .from(s.userMemories)
    .where(and(eq(s.userMemories.userId, userId)))) as MemoryRow[];

  const scored = all
    .filter((m) => (m.scope === "profile" || m.scope === "custom") && m.embedding)
    .map((m) => {
      const emb = typeof m.embedding === "string" ? (JSON.parse(m.embedding) as Vector) : (m.embedding as Vector);
      return { ...m, similarity: cosineSimilarity(queryVec, emb) };
    })
    .filter((m) => m.similarity >= DEFAULT_MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored.map((m) => ({ id: m.id, scope: m.scope as UserMemory["scope"], content: m.content, source: (m.source ?? "manual") as UserMemory["source"] }));
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
