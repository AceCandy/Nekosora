/**
 * 记忆自动提取 -- 对话流结束后,把最近 N 轮对话交给 mem0 全权抽取 + 合并。
 *
 * mem0 全权抽取(infer=true):LLM 从对话产记忆 + 去重 + 合并(mem0 内置)。
 * AI 抽取的记忆统一标 scope=project(对话中多为当前项目);preference/profile 由用户手动添加。
 *
 * 触发频率保护:同一用户 10 分钟内最多提取一次。异步、失败静默(不阻断主对话)。
 */
import { getMemory } from "./mem0";
import { cacheWrap, cacheSet } from "@/lib/infra/cache";
import { invalidateMemoryCache, toProjectExpirationDate } from "./service";

const RECENT_TURNS = 6; // 取最近 N 条消息做提取

/**
 * 从最近对话提取记忆(mem0 全权抽取)。异步、不抛错(调用方用 .catch 吞掉)。
 * @param _model 保留签名兼容调用方;mem0 用自身配置的 LLM,忽略此参。
 */
export async function extractMemories(
  userId: string,
  _conversationId: string,
  recentMessages: { role: string; content: string }[],
  _model?: string,
): Promise<void> {
  // 频率保护:10 分钟内不重复提取
  const recentlyExtracted = await cacheWrap(
    `memextract:${userId}`,
    async () => false,
    600_000,
  );
  if (recentlyExtracted) return;

  const turns = recentMessages.slice(-RECENT_TURNS);
  if (turns.length < 2) return;

  const messages = turns.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content.slice(0, 500),
  }));

  try {
    const memory = await getMemory();
    const expirationDate = toProjectExpirationDate(); // project 记忆 7 天过期(mem0 软过滤 + 懒硬删)
    await memory.add(messages, {
      userId,
      expirationDate,
      metadata: { scope: "project", source: "ai", expirationDate },
    });
  } catch {
    return; // 提取失败静默跳过
  }

  // 标记已提取(用 cacheSet 覆盖,cacheWrap 不会覆盖已有值)
  cacheSet(`memextract:${userId}`, true, 600_000).catch(() => {});
  // 失效记忆缓存(mem0 写入后,getMemories 的 60s 缓存需刷新)
  invalidateMemoryCache(userId).catch(() => {});
}
