/**
 * 会话标题自动生成 —— 首条用户消息先写 fallback，最终标题由后台 worker 生成。
 *
 * 模型优先级：task.title_model_id > 旧 task.title_model > 当前对话模型。
 * 最终更新带标题条件，避免后台任务覆盖用户手动改名。
 */
import { and, eq, or } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { generateChat } from "@/lib/stream";
import { getSetting } from "@/lib/system-settings/service";
import type { IRRequest } from "@/lib/providers/types";

const DEFAULT_TITLE = "新会话";
const TITLE_MODEL_FALLBACK = "gpt-4o-mini";
const MAX_TITLE_LEN = 30;
const FALLBACK_MAX_LEN = 16;

/** 标记应由后台队列重试的标题生成失败，并避免携带上游错误详情。 */
class ConversationTitleGenerationError extends Error {
  constructor() {
    super("会话标题生成失败");
    this.name = "ConversationTitleGenerationError";
  }
}

export interface ConversationTitleJob {
  userId: string;
  conversationId: string;
  firstUserMessage: string;
  fallbackTitle: string;
  chatModel?: string;
  chatModelId?: string;
}

interface ResolvedTitleModel {
  name: string;
  id?: string;
}

/** 保留兼容导出。配置不再永久缓存，独立 worker 可在下个任务读取新值。 */
export function resetTitleModelConfig(): void {
  // no-op
}

/** 首条消息同步写入可读 fallback；标题已修改时返回 null，不创建后台任务。 */
export async function writeFallbackTitle(
  userId: string,
  conversationId: string,
  firstUserMessage: string,
): Promise<string | null> {
  if (!firstUserMessage.trim()) return null;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const fallback = truncateFallbackTitle(firstUserMessage);
  const updated = await db
    .update(s.conversations)
    .set({ title: fallback })
    .where(and(
      eq(s.conversations.id, conversationId),
      eq(s.conversations.userId, userId),
      eq(s.conversations.title, DEFAULT_TITLE),
    ))
    .returning({ id: s.conversations.id });

  return updated.length > 0 ? fallback : null;
}

/** Worker 调用：读取当前配置生成最终标题，并仅覆盖本轮 fallback。 */
export async function generateConversationTitle(job: ConversationTitleJob): Promise<string | null> {
  if (!job.firstUserMessage.trim()) return null;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const [conv] = await db
    .select({ title: s.conversations.title })
    .from(s.conversations)
    .where(and(
      eq(s.conversations.id, job.conversationId),
      eq(s.conversations.userId, job.userId),
    ))
    .limit(1);
  if (!conv || (conv.title !== DEFAULT_TITLE && conv.title !== job.fallbackTitle)) return null;

  const target = await resolveTitleModel(job.chatModel, job.chatModelId);
  const prompt =
    "请把下面这段用户提问概括成一个简短的对话标题(不超过 " +
    MAX_TITLE_LEN +
    " 字,纯文本,不要引号、不要标点结尾、不要\"标题:\"前缀):\n\n" +
    job.firstUserMessage.slice(0, 500);
  const ctx = { userId: job.userId, keyKind: null as null, source: "chat" as const };
  const request: IRRequest = {
    model: target.name,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 64,
  };

  let result;
  try {
    result = await generateChat({
      ctx,
      request,
      modelId: target.id,
      taskKind: "title",
    });
  } catch {
    throw new ConversationTitleGenerationError();
  }
  if (result.error || !result.text) throw new ConversationTitleGenerationError();

  const title = sanitizeTitle(result.text);
  if (!title) throw new ConversationTitleGenerationError();

  const updated = await db
    .update(s.conversations)
    .set({ title })
    .where(and(
      eq(s.conversations.id, job.conversationId),
      eq(s.conversations.userId, job.userId),
      or(
        eq(s.conversations.title, DEFAULT_TITLE),
        eq(s.conversations.title, job.fallbackTitle),
      ),
    ))
    .returning({ id: s.conversations.id });

  return updated.length > 0 ? title : null;
}

/** 兼容旧调用：fallback 与最终标题仍依次回调。Chat 主链路不再使用。 */
export async function maybeGenerateTitle(
  userId: string,
  conversationId: string,
  firstUserMessage: string,
  chatModel?: string,
  onTitle?: (title: string) => void,
): Promise<void> {
  const fallbackTitle = await writeFallbackTitle(userId, conversationId, firstUserMessage);
  if (!fallbackTitle) return;
  onTitle?.(fallbackTitle);
  let title: string | null;
  try {
    title = await generateConversationTitle({
      userId,
      conversationId,
      firstUserMessage,
      fallbackTitle,
      chatModel,
    });
  } catch (error) {
    if (error instanceof ConversationTitleGenerationError) return;
    throw error;
  }
  if (title) onTitle?.(title);
}

/** 配置 ID 优先；旧 name 保持 owner by-name 路由语义；最后回退当前对话模型。 */
async function resolveTitleModel(
  chatModel?: string,
  chatModelId?: string,
): Promise<ResolvedTitleModel> {
  const configuredId = await getSetting("task", "title_model_id");
  if (configuredId) {
    const configured = await findPublicModelById(configuredId);
    if (configured) return configured;
  }

  const legacyName = await getSetting("task", "title_model");
  if (legacyName) {
    const configured = await findPublicModelByName(legacyName);
    if (configured) return configured;
    return { name: legacyName };
  }

  return {
    name: chatModel || TITLE_MODEL_FALLBACK,
    ...(chatModelId ? { id: chatModelId } : {}),
  };
}

async function findPublicModelById(id: string): Promise<ResolvedTitleModel | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [model] = await db
    .select({ id: s.models.id, name: s.models.name })
    .from(s.models)
    .where(and(
      eq(s.models.id, id),
      eq(s.models.visibility, "public"),
      eq(s.models.enabled, true),
    ))
    .limit(1);
  return model ? { id: String(model.id), name: String(model.name) } : null;
}

async function findPublicModelByName(name: string): Promise<ResolvedTitleModel | null> {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const [model] = await db
    .select({ id: s.models.id, name: s.models.name })
    .from(s.models)
    .where(and(
      eq(s.models.name, name),
      eq(s.models.visibility, "public"),
      eq(s.models.enabled, true),
    ))
    .limit(1);
  return model ? { id: String(model.id), name: String(model.name) } : null;
}

/** Fallback 标题：截断首条消息到指定长度，折叠空白。 */
function truncateFallbackTitle(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  return t.length > FALLBACK_MAX_LEN ? t.slice(0, FALLBACK_MAX_LEN) + "…" : t || DEFAULT_TITLE;
}

/** 清洗 LLM 输出为干净标题：去引号/前缀/换行并截断。 */
function sanitizeTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["'“”‘’《「]+|["'“”‘’》」]+$/g, "");
  t = t.replace(/^(标题|title)[:：]\s*/i, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > MAX_TITLE_LEN) t = t.slice(0, MAX_TITLE_LEN);
  return t;
}
