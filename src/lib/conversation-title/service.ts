/**
 * 会话标题自动生成 —— 首条用户消息先写 fallback，最终标题由后台 worker 生成。
 *
 * 模型优先级：task.title_model_id > 旧 task.title_model > 当前对话模型。
 * 最终更新带标题条件，避免后台任务覆盖用户手动改名。
 */
import { and, eq, or, sql } from "drizzle-orm";
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
  id: string;
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

/** 在同一事务中写入可读 fallback 与待投递任务；标题已修改时不创建任务。 */
export async function writeFallbackTitle(
  userId: string,
  conversationId: string,
  firstUserMessage: string,
  chatModel?: string,
  chatModelId?: string,
): Promise<ConversationTitleJob | null> {
  if (!firstUserMessage.trim()) return null;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const fallback = truncateFallbackTitle(firstUserMessage);
  const job: ConversationTitleJob = {
    id: globalThis.crypto.randomUUID(),
    userId,
    conversationId,
    firstUserMessage,
    fallbackTitle: fallback,
    ...(chatModel ? { chatModel } : {}),
    ...(chatModelId ? { chatModelId } : {}),
  };

  return db.transaction(async (tx: typeof db) => {
    const updated = await tx
      .update(s.conversations)
      .set({ title: fallback })
      .where(and(
        eq(s.conversations.id, conversationId),
        eq(s.conversations.userId, userId),
        eq(s.conversations.title, DEFAULT_TITLE),
      ))
      .returning({ id: s.conversations.id });
    if (updated.length === 0) return null;

    const values = {
      id: job.id,
      userId,
      conversationId,
      firstUserMessage,
      fallbackTitle: fallback,
      chatModel: chatModel ?? null,
      chatModelId: chatModelId ?? null,
    };
    await tx
      .insert(s.conversationTitleJobs)
      .values(values)
      .onConflictDoUpdate({
        target: s.conversationTitleJobs.conversationId,
        set: {
          ...values,
          dispatchAfter: sql`now()`,
          createdAt: sql`now()`,
        },
      });
    return job;
  });
}

/** Worker 调用：用 job id 双重 fencing，并仅覆盖本轮 fallback。 */
export async function generateConversationTitle(job: ConversationTitleJob): Promise<string | null> {
  if (!job.firstUserMessage.trim()) return null;

  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  const [currentJob] = await db
    .select({ id: s.conversationTitleJobs.id })
    .from(s.conversationTitleJobs)
    .where(and(
      eq(s.conversationTitleJobs.id, job.id),
      eq(s.conversationTitleJobs.conversationId, job.conversationId),
      eq(s.conversationTitleJobs.userId, job.userId),
    ))
    .limit(1);
  if (!currentJob) return null;

  const [conv] = await db
    .select({ title: s.conversations.title })
    .from(s.conversations)
    .where(and(
      eq(s.conversations.id, job.conversationId),
      eq(s.conversations.userId, job.userId),
    ))
    .limit(1);
  if (!conv || !canReplaceTitle(conv.title, job.fallbackTitle)) {
    await deleteTitleJob(db, s, job.id);
    return null;
  }

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

  return db.transaction(async (tx: typeof db) => {
    // 与 fallback 事务保持相同的 conversations -> outbox 锁顺序，避免交叉等待。
    const [lockedConversation] = await tx
      .select({ title: s.conversations.title })
      .from(s.conversations)
      .where(and(
        eq(s.conversations.id, job.conversationId),
        eq(s.conversations.userId, job.userId),
      ))
      .limit(1)
      .for("update");
    if (!lockedConversation) {
      await deleteTitleJob(tx, s, job.id);
      return null;
    }

    const [stillCurrent] = await tx
      .select({ id: s.conversationTitleJobs.id })
      .from(s.conversationTitleJobs)
      .where(and(
        eq(s.conversationTitleJobs.id, job.id),
        eq(s.conversationTitleJobs.conversationId, job.conversationId),
        eq(s.conversationTitleJobs.userId, job.userId),
      ))
      .limit(1);
    if (!stillCurrent) return null;
    if (!canReplaceTitle(lockedConversation.title, job.fallbackTitle)) {
      await deleteTitleJob(tx, s, job.id);
      return null;
    }

    const updated = await tx
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
    await deleteTitleJob(tx, s, job.id);
    return updated.length > 0 ? title : null;
  });
}

/** 兼容旧调用：fallback 与最终标题仍依次回调。Chat 主链路不再使用。 */
export async function maybeGenerateTitle(
  userId: string,
  conversationId: string,
  firstUserMessage: string,
  chatModel?: string,
  onTitle?: (title: string) => void,
): Promise<void> {
  const job = await writeFallbackTitle(userId, conversationId, firstUserMessage, chatModel);
  if (!job) return;
  onTitle?.(job.fallbackTitle);
  let title: string | null;
  try {
    title = await generateConversationTitle(job);
  } catch (error) {
    if (error instanceof ConversationTitleGenerationError) return;
    throw error;
  }
  if (title) onTitle?.(title);
}

function canReplaceTitle(title: unknown, fallbackTitle: string): boolean {
  return title === DEFAULT_TITLE || title === fallbackTitle;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deleteTitleJob(db: any, s: any, jobId: string): Promise<void> {
  await db.delete(s.conversationTitleJobs).where(eq(s.conversationTitleJobs.id, jobId));
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
