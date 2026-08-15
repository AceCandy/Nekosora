/**
 * 记忆语义召回 -- 用 mem0.search 在用户 project 记忆中检索相关项。
 *
 * mem0 全权存储/检索:向量召回 + 相似度过滤由 mem0 负责。
 * project 过期(M-4 用 mem0 expirationDate)+ preference/profile 恒定注入不参与召回。
 */
import { getMemory } from "./mem0";
import { toUserMemory, type UserMemory } from "./service";
import { isMemoryEligibleText } from "./policy";

const DEFAULT_RECALL_TOP_K = 5;
const RECALL_THRESHOLD = 0.5;

/**
 * 按查询语义召回 project 记忆(mem0 向量检索 + scope 过滤)。
 * mem0 不可用时静默返回空(不阻断对话)。
 */
export async function recallMemories(
  userId: string,
  query: string,
  topK = DEFAULT_RECALL_TOP_K,
): Promise<UserMemory[]> {
  if (!isMemoryEligibleText(query)) return [];

  try {
    const memory = await getMemory();
    const res = await memory.search(query, {
      topK,
      threshold: RECALL_THRESHOLD,
      filters: { user_id: userId, scope: "project" },
    });
    return (res.results ?? []).map(toUserMemory);
  } catch {
    return [];
  }
}
