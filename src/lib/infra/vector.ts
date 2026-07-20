/**
 * 向量工具 —— pgvector(PostgreSQL)序列化与距离↔相似度转换。
 *
 * 本文件提供:
 *   - 维度常量与向量工具(序列化、距离↔相似度转换)
 *   - 生成 embedding 的入口(委托给 AI SDK embedding provider)
 *
 * PG:  file_chunks.embedding 类型为 vector(1024),用 `<=>`(余弦距离)算子。
 */
export const EMBEDDING_DIM = 1024; // bge-m3 维度

export type Vector = number[];

/** 将 number[] 序列化为 pgvector 可接受的字面量 "[0.1,0.2,...]"。 */
export function toPgVector(v: Vector): string {
  return `[${v.join(",")}]`;
}

export function serialize(v: Vector): string {
  return toPgVector(v);
}

/** 余弦距离 [0,2] → 相似度 [0,1]:similarity = 1 - distance/2。 */
export function distanceToSimilarity(cosineDistance: number): number {
  return 1 - cosineDistance / 2;
}

/** 阈值过滤(默认 0.45,借鉴 DEEIX RAGMinSimilarity)。 */
export const DEFAULT_MIN_SIMILARITY = 0.45;

export interface VectorMatch {
  id: number | string;
  score: number; // 相似度,越大越相关
  content: string;
  fileId?: number | string;
  chunkIndex?: number;
  pageNum?: number;
}

/**
 * 用 embedding provider 生成查询向量。
 * provider 实例在阶段 3 由 registry 构造;此处为纯函数契约。
 */
export async function embedQuery(
  embed: (text: string) => Promise<Vector>,
  text: string,
): Promise<Vector> {
  return embed(text);
}
