/**
 * 记忆语义召回 -- 用 mem0.search 在用户 project 记忆中检索相关项。
 *
 * mem0 全权存储/检索:向量召回 + 相似度过滤由 mem0 负责。
 * project 过期(M-4 用 mem0 expirationDate)+ preference/profile 恒定注入不参与召回。
 */
import { getMemory } from "./mem0";
import { toUserMemory, type UserMemory } from "./service";

const DEFAULT_RECALL_TOP_K = 5;

/**
 * 按查询语义召回 project 记忆(mem0 向量检索 + scope 过滤)。
 * mem0 不可用时静默返回空(不阻断对话)。
 */
export async function recallMemories(
  userId: string,
  query: string,
  topK = DEFAULT_RECALL_TOP_K,
): Promise<UserMemory[]> {
  try {
    const memory = await getMemory();
    const res = await memory.search(query, {
      topK,
      filters: { user_id: userId, scope: "project" },
    });
    return (res.results ?? []).map(toUserMemory);
  } catch {
    return [];
  }
}

export interface MemoryDiagnostics {
  /** 疑似重复的记忆 id 集合。 */
  duplicateIds: Set<string>;
  /** 陈旧的 project 记忆 id 集合。 */
  staleIds: Set<string>;
}

/**
 * 记忆健康诊断(M-4 待重建为基于 mem0)。
 * M-3 切换 mem0 数据源后,旧 user_memories 诊断逻辑失效,暂返回空。
 */
export async function getMemoryDiagnostics(_userId: string): Promise<MemoryDiagnostics> {
  return { duplicateIds: new Set(), staleIds: new Set() };
}
