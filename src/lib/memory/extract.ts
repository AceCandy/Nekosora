/**
 * 记忆自动提取 —— 对话流结束后,从最近 N 轮对话提取偏好/事实,embed 后存入 user_memories。
 *
 * 策略(design §2):
 *   - 用一次轻量 LLM 调用(复用网关 streamChat),prompt 要求只输出 JSON 数组
 *   - 每条产出 content + disclosure + scope + priority + confidence
 *   - 写入前去重:向量近邻检查(相似度 > 0.85)
 *     · preference/profile:仅 confidence=explicit 覆盖,weak 丢弃
 *     · project:直接覆盖 + 刷新 lastAccessedAt(续命)
 *   - embedding 用融合向量 embed(content + " " + disclosure)
 *   - project 1 周过期懒清理(入口触发)
 *   - 异步执行,失败静默(不阻断主对话)
 *
 * 触发频率保护:同一用户 10 分钟内最多提取一次。
 */
import { and, eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { streamChat } from "@/lib/stream";
import { embedText } from "@/lib/rag/embedding";
import { cacheWrap, cacheSet } from "@/lib/infra/cache";
import type { IRRequest } from "@/lib/providers/types";
import { invalidateMemoryCache, purgeExpiredProjectMemories, defaultPriorityForScope, type MemoryScope } from "./service";
import { findSimilarMemory } from "./recall";

const RECENT_TURNS = 6; // 取最近 N 条消息做提取
const EXTRACT_MODEL_FALLBACK = "gpt-4o-mini";
const MAX_MEMORIES = 5;

export interface ExtractedMemory {
  content: string;
  disclosure: string;
  scope: MemoryScope;
  priority: number;
  confidence: "explicit" | "weak";
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

  // project 过期懒清理
  await purgeExpiredProjectMemories(userId).catch(() => {});

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
  let wroteAny = false;

  for (const mem of memories.slice(0, MAX_MEMORIES)) {
    try {
      // 融合向量:embed(content + " " + disclosure)
      const fusionText = mem.disclosure ? `${mem.content} ${mem.disclosure}` : mem.content;
      const embedding = await embedText(fusionText).catch(() => null);

      // 写入前去重:向量近邻检查
      if (embedding) {
        const similar = await findSimilarMemory(userId, embedding, mem.scope).catch(() => null);
        if (similar) {
          // preference/profile:仅 explicit 覆盖,weak 丢弃
          if ((mem.scope === "preference" || mem.scope === "profile") && mem.confidence !== "explicit") {
            continue; // weak → 不记,保留原有
          }
          // 覆盖:UPDATE content/disclosure/priority/embedding + 刷新 lastAccessedAt
          await db
            .update(s.userMemories)
            .set({
              content: mem.content,
              disclosure: mem.disclosure || null,
              priority: mem.priority,
              embedding,
              lastAccessedAt: new Date(),
            })
            .where(and(eq(s.userMemories.id, similar.id), eq(s.userMemories.userId, userId)));
          wroteAny = true;
          continue;
        }
      }

      // 未命中:insert
      await db.insert(s.userMemories).values({
        userId,
        scope: mem.scope,
        source: "ai",
        content: mem.content,
        disclosure: mem.disclosure || null,
        priority: mem.priority,
        embedding,
        lastAccessedAt: new Date(),
      });
      wroteAny = true;
    } catch {
      /* 单条写入失败跳过 */
    }
  }

  // 标记已提取(用 cacheSet 覆盖,cacheWrap 不会覆盖已有值)
  cacheSet(`memextract:${userId}`, true, 600_000).catch(() => {});
  // 失效记忆缓存(仅在实际写入时)
  if (wroteAny) {
    invalidateMemoryCache(userId).catch(() => {});
  }
}

/** 构造提取 prompt。 */
function buildExtractPrompt(transcript: string): string {
  return `你是一个记忆提取助手。从以下对话中提取值得长期记住的用户偏好、身份事实或正在进行的事。
只输出 JSON 数组,每项形如:
{"content":"...","disclosure":"...","scope":"preference|profile|project","priority":0,"confidence":"explicit|weak"}

字段说明:
- content:    值得记住的稳定事实/偏好(简明陈述)
- disclosure: 何时该想起这条记忆(自然语言,如"讨论代码风格时"、"提到项目技术栈时")
- scope:      preference(用户偏好:语言、风格、格式等)/ profile(身份事实:职业、领域、技能等)/ project(在做的事:项目、任务、计划等)
- priority:   重要性 0-3(0 最低),不确定时按 scope 默认:preference=0/profile=1/project=2
- confidence: explicit(用户明确陈述或变更的事实) / weak(模糊、推测、临时的话)

规则:
- confidence=explicit:用户直接说"我喜欢...""我是...""我正在做..."
- confidence=weak:推测("也许""可能")、临时情绪、未确认的猜测
- 如果没有值得提取的内容,输出 []
- 不要输出任何解释

对话:
${transcript}`;
}

/** 解析 LLM 输出为记忆数组(容错:提取首个 JSON 数组)。 */
export function parseExtracted(raw: string): ExtractedMemory[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as {
      content?: string;
      disclosure?: string;
      scope?: string;
      priority?: number;
      confidence?: string;
    }[];
    return arr
      .filter((m) => m.content && typeof m.content === "string")
      .map((m) => {
        const scope = (["preference", "profile", "project"].includes(m.scope ?? "")
          ? m.scope
          : "project") as MemoryScope;
        const confidence = m.confidence === "explicit" ? "explicit" : "weak";
        return {
          content: m.content!.slice(0, 500),
          disclosure: (m.disclosure ?? "").slice(0, 200).trim(),
          scope,
          priority: typeof m.priority === "number" ? m.priority : defaultPriorityForScope(scope),
          confidence,
        };
      });
  } catch {
    return [];
  }
}
