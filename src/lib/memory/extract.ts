/**
 * 记忆自动提取 —— 对话流结束后,从最近 N 轮对话提取偏好/事实,embed 后存入 user_memories。
 *
 * 策略(借鉴 DEEIX):
 *   - 用一次轻量 LLM 调用(复用网关 streamChat),prompt 要求只输出 JSON 数组
 *   - 每条记忆 embed 后写入(scope 自动判定)
 *   - 异步执行,失败静默(不阻断主对话)
 *
 * 触发频率保护:同一用户 10 分钟内最多提取一次(避免每轮都调用)。
 */
import { getDb, getSchema } from "@/lib/infra/db";
import { streamChat } from "@/lib/stream";
import { embedText } from "@/lib/rag/embedding";
import { cacheWrap } from "@/lib/infra/cache";
import type { IRRequest } from "@/lib/providers/types";

const RECENT_TURNS = 6; // 取最近 N 条消息做提取
const EXTRACT_MODEL_FALLBACK = "gpt-4o-mini";

interface ExtractedMemory {
  content: string;
  scope: "preference" | "profile" | "custom";
}

/**
 * 从最近对话提取记忆。异步、不抛错(调用方用 .catch 吞掉)。
 * @param model 当前对话所用模型名(用于 LLM 调用)
 */
export async function extractMemories(
  userId: string,
  conversationId: string,
  recentMessages: { role: string; content: string }[],
  model?: string,
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

  const transcript = turns
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  const prompt = buildExtractPrompt(transcript);
  const ctx = { userId, keyKind: null as null, source: "chat" as const };
  const request: IRRequest = {
    model: model || EXTRACT_MODEL_FALLBACK,
    messages: [{ role: "user", content: prompt }],
    stream: true,
  };

  let raw = "";
  try {
    for await (const ev of streamChat({ ctx, request, taskKind: "memory" })) {
      if (ev.type === "text-delta") raw += ev.text;
      if (ev.type === "error") return; // 提取失败静默跳过
    }
  } catch {
    return;
  }

  const memories = parseExtracted(raw);
  if (memories.length === 0) return;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  for (const mem of memories.slice(0, 5)) {
    try {
      const embedding = await embedText(mem.content).catch(() => null);
      await db.insert(s.userMemories).values({
        userId,
        scope: mem.scope,
        source: "ai",
        content: mem.content,
        embedding,
      });
    } catch {
      /* 单条写入失败跳过 */
    }
  }

  // 标记已提取(刷新记忆缓存)
  cacheWrap(`memextract:${userId}`, async () => true, 600_000).catch(() => {});
  invalidateMemoryCache(userId);
}

/** 构造提取 prompt。 */
function buildExtractPrompt(transcript: string): string {
  return `你是一个记忆提取助手。从以下对话中提取值得长期记住的用户偏好或事实。
只输出 JSON 数组,每项形如 {"content":"...","scope":"preference|profile|custom"}。
- preference:用户的明确偏好(语言、风格、格式等)
- profile:用户的客观事实(身份、领域、项目等)
- custom:其他值得记住的信息
如果没有值得提取的内容,输出 []。不要输出任何解释。

对话:
${transcript}`;
}

/** 解析 LLM 输出为记忆数组(容错:提取首个 JSON 数组)。 */
function parseExtracted(raw: string): ExtractedMemory[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as { content?: string; scope?: string }[];
    return arr
      .filter((m) => m.content && typeof m.content === "string")
      .map((m) => ({
        content: m.content!.slice(0, 500),
        scope: (["preference", "profile", "custom"].includes(m.scope ?? "") ? m.scope : "custom") as ExtractedMemory["scope"],
      }));
  } catch {
    return [];
  }
}

/** 使记忆缓存失效(供 extract 后 + 手动增删后调用)。 */
export function invalidateMemoryCache(userId: string): void {
  // cacheWrap 的缓存 key 与 service.ts 一致,这里通过写入空值触发刷新不可行;
  // 改为直接重置内部缓存标记(简化:依赖 TTL 自然过期,手动操作走 revalidatePath)
  void userId;
}
