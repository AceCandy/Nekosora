/**
 * 向量检索 dialect 适配 —— pgvector(PostgreSQL)或 sqlite-vec(SQLite)降级。
 *
 * 本文件提供:
 *   - 维度常量与向量工具(序列化、距离↔相似度转换)
 *   - 生成 embedding 的入口(委托给 AI SDK embedding provider)
 *   - 检索 SQL 片段的 dialect 差异封装(阶段 2 schema 完成后由 repository 调用)
 *
 * PG:  file_chunks.embedding 类型为 vector(1536),用 `<=>`(余弦距离)算子。
 * SQLite: 加载 sqlite-vec 扩展,vec0 虚拟表,vec_distance_cosine。
 */
import { isPg } from "@/lib/infra/db";

export const EMBEDDING_DIM = 1536; // OpenAI text-embedding-3-small 维度

export type Vector = number[];

/** 将 number[] 序列化为 pgvector 可接受的字面量 "[0.1,0.2,...]"。 */
export function toPgVector(v: Vector): string {
  return `[${v.join(",")}]`;
}

/** sqlite-vec 以 JSON 数组字符串或 BLOB 传递;此处用 JSON 字符串。 */
export function toSqliteVec(v: Vector): string {
  return JSON.stringify(v);
}

export function serialize(v: Vector): string {
  return isPg ? toPgVector(v) : toSqliteVec(v);
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
