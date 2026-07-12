/**
 * RAG 检索服务 —— 内存余弦向量检索 + 文档序重排 + token 预算打包。
 *
 * 流程(借鉴 DEEIX-Chat):
 *   1. embedText(query)
 *   2. 向量搜索(取候选块后在内存算余弦相似度,内部规模够用)
 *   3. 过滤 minSimilarity(默认 0.45)
 *   4. 按文档顺序重排(chunk_index 升序),便于阅读
 *   5. token 预算打包(默认 2000)
 *
 * RetrieveStatus 驱动上层回退逻辑。
 */
import { eq, and, inArray } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { DEFAULT_MIN_SIMILARITY, type Vector } from "@/lib/infra/vector";
import { embedText } from "./embedding";
import { estimateTokens } from "@/lib/tokens";

export const DEFAULT_TOP_K = 5;
export const DEFAULT_RAG_TOKEN_BUDGET = 2000;
const FETCH_MULTIPLIER = 3; // 先取 topK*3 再过滤

export type RetrieveStatus =
  | "rag_hit"
  | "rag_empty"
  | "rag_low_score"
  | "rag_timeout"
  | "rag_error"
  | "rag_unavailable";

export interface RetrievedChunk {
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  status: RetrieveStatus;
  candidateCount: number;
  maxScore: number;
  cached: boolean;
}

interface RawCandidate {
  chunkId: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  embedding: Vector | string | null;
  filename: string;
}

/** 检索与查询相关的文件块。fileIds 限定检索范围(空则全量)。 */
export async function retrieve(
  query: string,
  fileIds: string[],
  opts: {
    topK?: number;
    minSimilarity?: number;
    tokenBudget?: number;
    timeoutMs?: number;
  } = {},
): Promise<RetrieveResult> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const tokenBudget = opts.tokenBudget ?? DEFAULT_RAG_TOKEN_BUDGET;
  const timeoutMs = opts.timeoutMs ?? 3000;

  // 超时保护:超过时限直接返回 unavailable-ish(上层回退)
  const timeoutPromise = new Promise<RetrieveResult>((resolve) =>
    setTimeout(
      () => resolve({ chunks: [], status: "rag_timeout", candidateCount: 0, maxScore: 0, cached: false }),
      timeoutMs,
    ),
  );

  try {
    return await Promise.race([doRetrieve(query, fileIds, topK, minSim, tokenBudget), timeoutPromise]);
  } catch (err) {
    console.error("[rag] retrieve error:", err);
    return { chunks: [], status: "rag_error", candidateCount: 0, maxScore: 0, cached: false };
  }
}

async function doRetrieve(
  query: string,
  fileIds: string[],
  topK: number,
  minSim: number,
  tokenBudget: number,
): Promise<RetrieveResult> {
  // 1. 嵌入查询
  let queryVec: Vector;
  try {
    queryVec = await embedText(query);
  } catch {
    return { chunks: [], status: "rag_unavailable", candidateCount: 0, maxScore: 0, cached: false };
  }

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  // 2. 取候选块(限定文件 + rag_ready)
  const where = fileIds.length
    ? and(inArray(s.fileChunks.fileId, fileIds))
    : undefined;
  // 关联 file_objects 取 filename,且只取 rag_ready 的文件
  const rows = await db
    .select({
      chunk: s.fileChunks,
      file: s.fileObjects,
    })
    .from(s.fileChunks)
    .innerJoin(s.fileObjects, eq(s.fileChunks.fileId, s.fileObjects.id))
    .where(where);

  // 过滤 rag_ready
  const candidates: RawCandidate[] = rows
    .filter((r: Record<string, unknown>) => (r.file as Record<string, unknown>).ragReady)
    .map((r: Record<string, unknown>) => {
      const chunk = r.chunk as Record<string, unknown>;
      const file = r.file as Record<string, unknown>;
      return {
        chunkId: chunk.id as string,
        fileId: chunk.fileId as string,
        chunkIndex: chunk.chunkIndex as number,
        content: chunk.content as string,
        embedding: (chunk.embedding ?? null) as Vector | string | null,
        filename: (file.filename as string) ?? "",
      };
    });

  if (candidates.length === 0) {
    return { chunks: [], status: "rag_empty", candidateCount: 0, maxScore: 0, cached: false };
  }

  // 3. 计算相似度(PG 可走 DB 算子,这里统一用内存余弦 —— 简单可靠,内部规模够用)
  const scored = candidates
    .map((c) => {
      const emb = parseEmbedding(c.embedding);
      const sim = emb ? cosineSimilarity(queryVec, emb) : 0;
      return { ...c, similarity: sim };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const fetchK = topK * FETCH_MULTIPLIER;
  const top = scored.slice(0, fetchK);

  // 4. minSimilarity 过滤
  const filtered = top.filter((c) => c.similarity >= minSim);
  if (filtered.length === 0) {
    return {
      chunks: [],
      status: "rag_low_score",
      candidateCount: scored.length,
      maxScore: scored[0]?.similarity ?? 0,
      cached: false,
    };
  }

  // 5. 文档序重排(按 file + chunk_index),便于阅读
  filtered.sort((a, b) => {
    if (a.fileId !== b.fileId) return a.fileId.localeCompare(b.fileId);
    return a.chunkIndex - b.chunkIndex;
  });

  // 6. token 预算打包
  const packed: RetrievedChunk[] = [];
  let used = 0;
  for (const c of filtered) {
    const cost = estimateTokens(c.content);
    if (used + cost > tokenBudget) break;
    packed.push({
      fileId: c.fileId,
      filename: c.filename,
      chunkIndex: c.chunkIndex,
      content: c.content,
      similarity: c.similarity,
    });
    used += cost;
  }

  return {
    chunks: packed,
    status: "rag_hit",
    candidateCount: scored.length,
    maxScore: scored[0]?.similarity ?? 0,
    cached: false,
  };
}

/** 解析存储的 embedding(pgvector 存为 "[0.1,...]" 字符串)。 */
function parseEmbedding(raw: Vector | string | null): Vector | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  try {
    const s = raw.replace(/^\[/, "").replace(/\]$/, "");
    return s.split(",").map(Number);
  } catch {
    return null;
  }
}

/** 余弦相似度 [0,1]。 */
function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return (cos + 1) / 2; // [-1,1] → [0,1]
}
