/**
 * 记忆自动提取 -- 对话流结束后,把最近 N 轮对话交给 mem0 全权抽取 + 合并。
 *
 * mem0 全权抽取(infer=true):LLM 从对话产记忆 + 去重 + 合并(mem0 内置)。
 * AI 抽取的记忆统一标 scope=project(对话中多为当前项目);preference/profile 由用户手动添加。
 *
 * 触发频率保护:同一用户 10 分钟内最多提取一次。核心失败向 worker 抛通用错误以触发重试。
 */
import type { MemoryExtractionMessage } from "@/db/types";
import { getMemory } from "./mem0";
import { cacheWrap, cacheSet } from "@/lib/infra/cache";
import { invalidateMemoryCache, toProjectExpirationDate } from "./service";

const RECENT_TURNS = 6; // 取最近 N 条消息做提取
const MAX_TURN_LENGTH = 500;

/** Worker 可重试的通用失败，不携带上游或消息详情。 */
export class MemoryExtractionError extends Error {
  constructor() {
    super("记忆提取失败");
    this.name = "MemoryExtractionError";
  }
}

/** 收敛为持久化与 mem0 共用的最小输入，避免 durable intent 复制完整请求。 */
export function normalizeMemoryMessages(
  recentMessages: readonly { role: string; content: unknown }[],
): MemoryExtractionMessage[] {
  return recentMessages.slice(-RECENT_TURNS).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: typeof message.content === "string"
      ? message.content.slice(0, MAX_TURN_LENGTH)
      : String(message.content ?? "").slice(0, MAX_TURN_LENGTH),
  }));
}

/**
 * 从最近对话提取记忆(mem0 全权抽取)。成功与明确 no-op 返回，核心失败抛通用错误。
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

  const turns = normalizeMemoryMessages(recentMessages);
  if (turns.length < 2) return;

  try {
    const memory = await getMemory({ refreshModel: true });
    const expirationDate = toProjectExpirationDate(); // project 记忆 7 天过期(mem0 软过滤 + 懒硬删)
    await memory.add(turns, {
      userId,
      expirationDate,
      metadata: { scope: "project", source: "ai", expirationDate },
    });
  } catch {
    throw new MemoryExtractionError();
  }

  // 标记已提取(用 cacheSet 覆盖,cacheWrap 不会覆盖已有值)
  cacheSet(`memextract:${userId}`, true, 600_000).catch(() => {});
  // 失效记忆缓存(mem0 写入后,getMemories 的 60s 缓存需刷新)
  invalidateMemoryCache(userId).catch(() => {});
}
