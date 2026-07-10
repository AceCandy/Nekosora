"use server";
import { eq, and, or, desc, isNull, like, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import type { ReasoningLevel } from "@/db/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/**
 * 列出当前用户可见模型:visibility=public ∪ (private && owner=自己),且 enabled。
 * 返回扁平 models 数组(带 id/ownerUserId/visibility/name/displayName/capabilities,供阶段3 前端用)。
 * private 排序在前(方言无关:JS 层稳定排序,组内保持 sortOrder)。
 */
export async function getVisibleModels() {
  const user = await requireSession();
  const db = await getDb();
  const rows = await db
    .select()
    .from(S().models)
    .where(
      and(
        or(eq(S().models.visibility, "public"), eq(S().models.ownerUserId, user.id)),
        eq(S().models.enabled, true),
      ),
    )
    .orderBy(asc(S().models.sortOrder), asc(S().models.createdAt));
  // private 排在前(public 在后)
  rows.sort(
    (a: { visibility: string }, b: { visibility: string }) =>
      (a.visibility === "private" ? 0 : 1) - (b.visibility === "private" ? 0 : 1),
  );
  return rows;
}

/** 列出支持图像生成的可见模型(public ∪ 我的 private),按 capabilities.imageGeneration 过滤。 */
export async function getImageModels() {
  const user = await requireSession();
  const db = await getDb();
  const rows = await db
    .select()
    .from(S().models)
    .where(
      and(
        or(eq(S().models.visibility, "public"), eq(S().models.ownerUserId, user.id)),
        eq(S().models.enabled, true),
      ),
    )
    .orderBy(asc(S().models.sortOrder), asc(S().models.createdAt));
  const hasImg = (caps: unknown) =>
    Boolean((caps as { imageGeneration?: boolean } | null)?.imageGeneration);
  return rows.filter((m: Record<string, unknown>) => hasImg(m.capabilities));
}

/** 列出当前用户的会话(含置顶/归档/更新时间,供前端分组)。 */
export async function listConversations() {
  const user = await requireSession();
  const db = await getDb();
  return db
    .select({
      id: S().conversations.id,
      title: S().conversations.title,
      pinned: S().conversations.pinned,
      archived: S().conversations.archived,
      generating: S().conversations.generating,
      updatedAt: S().conversations.updatedAt,
    })
    .from(S().conversations)
    .where(eq(S().conversations.userId, user.id))
    .orderBy(desc(S().conversations.updatedAt));
}

/** 轻量轮询接口:只返回当前用户各会话的 id + generating,供侧栏检测后台会话完成。 */
export async function getGeneratingStatuses() {
  const user = await requireSession();
  const db = await getDb();
  const rows = await db
    .select({ id: S().conversations.id, generating: S().conversations.generating })
    .from(S().conversations)
    .where(eq(S().conversations.userId, user.id));
  return rows as { id: string; generating: boolean }[];
}

/** 新会话首次发送时携带的输入区状态(已选输出模式 / 输出样式 / 联网 / 指令卡 / 知识库)。 */
export interface CreateConversationOptions {
  outputModeId?: string | null;
  renderStyleId?: string | null;
  webSearch?: boolean;
  cardIds?: string[];
  kbIds?: string[];
}

/** 创建新会话(可选带入首次发送时的输入区状态)。 */
export async function createConversation(modelName?: string, options?: CreateConversationOptions) {
  const user = await requireSession();
  const db = await getDb();
  const [row] = await db
    .insert(S().conversations)
    .values({
      userId: user.id,
      title: "新会话",
      modelName: modelName ?? null,
      outputModeId: options?.outputModeId ?? null,
      renderStyleId: options?.renderStyleId ?? null,
      webSearch: options?.webSearch ?? false,
      composerState: options && (options.cardIds?.length || options.kbIds?.length)
        ? { cardIds: options.cardIds, kbIds: options.kbIds }
        : null,
    })
    .returning({ id: S().conversations.id });
  revalidatePath("/chat", "layout");
  return row.id as string;
}

/** 切换置顶状态。 */
export async function togglePinnedConversation(id: string) {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select({ userId: S().conversations.userId, pinned: S().conversations.pinned })
    .from(S().conversations)
    .where(eq(S().conversations.id, id))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.update(S().conversations).set({ pinned: !conv.pinned }).where(eq(S().conversations.id, id));
  revalidatePath("/chat", "layout");
}

/** 切换归档状态。 */
export async function toggleArchivedConversation(id: string) {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select({ userId: S().conversations.userId, archived: S().conversations.archived })
    .from(S().conversations)
    .where(eq(S().conversations.id, id))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.update(S().conversations).set({ archived: !conv.archived }).where(eq(S().conversations.id, id));
  revalidatePath("/chat", "layout");
}

/** 会话级输入区状态聚合视图(供 SSR 回填选择器)。 */
export interface ConversationComposerState {
  modelName: string | null;
  outputModeId: string | null;
  renderStyleId: string | null;
  webSearch: boolean;
  cardIds: string[];
  kbIds: string[];
  temperature?: number | null;
  topP?: number | null;
  maxTokens?: number | null;
  reasoning?: ReasoningLevel | null;
}

/** 校验当前用户对会话的属主关系,返回是否通过。 */
async function assertConversationOwner(conversationId: string, userId: string) {
  const db = await getDb();
  const [conv] = await db
    .select({ userId: S().conversations.userId })
    .from(S().conversations)
    .where(eq(S().conversations.id, conversationId))
    .limit(1);
  return !!conv && conv.userId === userId;
}

/** 设置会话的输出模式(null 表示清除,回到普通对话)。 */
export async function setConversationOutputMode(conversationId: string, outputModeId: string | null) {
  const user = await requireSession();
  if (!(await assertConversationOwner(conversationId, user.id))) throw new Error("无权操作");
  const db = await getDb();
  await db
    .update(S().conversations)
    .set({ outputModeId })
    .where(eq(S().conversations.id, conversationId));
}

/** 设置会话的输出样式(null 表示清除,回到默认渲染)。 */
export async function setConversationRenderStyle(conversationId: string, renderStyleId: string | null) {
  const user = await requireSession();
  if (!(await assertConversationOwner(conversationId, user.id))) throw new Error("无权操作");
  const db = await getDb();
  await db
    .update(S().conversations)
    .set({ renderStyleId })
    .where(eq(S().conversations.id, conversationId));
}

/** 设置会话使用的对外模型名(切换模型时落库)。 */
export async function setConversationModel(conversationId: string, modelName: string) {
  const user = await requireSession();
  if (!(await assertConversationOwner(conversationId, user.id))) throw new Error("无权操作");
  const db = await getDb();
  await db
    .update(S().conversations)
    .set({ modelName })
    .where(eq(S().conversations.id, conversationId));
}

/** 设置会话是否启用联网搜索。 */
export async function setConversationWebSearch(conversationId: string, enabled: boolean) {
  const user = await requireSession();
  if (!(await assertConversationOwner(conversationId, user.id))) throw new Error("无权操作");
  const db = await getDb();
  await db
    .update(S().conversations)
    .set({ webSearch: enabled })
    .where(eq(S().conversations.id, conversationId));
}

/** 设置会话的指令卡 / 知识库选择(整体替换 composerState)。 */
export async function setConversationComposerState(
  conversationId: string,
  state: { cardIds?: string[]; kbIds?: string[] },
) {
  const user = await requireSession();
  if (!(await assertConversationOwner(conversationId, user.id))) throw new Error("无权操作");
  const db = await getDb();
  await db
    .update(S().conversations)
    .set({ composerState: state })
    .where(eq(S().conversations.id, conversationId));
}

/**
 * 设置会话级模型参数(temperature/topP/maxTokens),合并到既有 composerState。
 * 传 null 表示清除该参数;undefined 不动。
 */
export async function setConversationModelParams(
  conversationId: string,
  params: { temperature?: number | null; topP?: number | null; maxTokens?: number | null; reasoning?: ReasoningLevel | null },
) {
  const user = await requireSession();
  if (!(await assertConversationOwner(conversationId, user.id))) throw new Error("无权操作");
  const db = await getDb();
  const [conv] = await db
    .select({ composerState: S().conversations.composerState })
    .from(S().conversations)
    .where(eq(S().conversations.id, conversationId))
    .limit(1);
  const prev = (conv?.composerState as Record<string, unknown> | null) ?? {};
  const next: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  await db
    .update(S().conversations)
    .set({ composerState: next })
    .where(eq(S().conversations.id, conversationId));
}

/**
 * 全文搜索当前用户会话的消息内容(LIKE,兼容 pg 的 jsonb 隐式转 text 与 sqlite text)。
 * 排除软删消息,按命中消息时间倒序,最多 50 条,每条返回前后约 30 字符的片段。
 */
export async function searchMessages(keyword: string): Promise<Array<{
  conversationId: string;
  conversationTitle: string;
  messagePublicId: string;
  snippet: string;
  createdAt: number;
}>> {
  const user = await requireSession();
  const kw = keyword.trim();
  if (!kw) return [];
  const db = await getDb();
  const s = S();
  const rows = await db
    .select({
      conversationId: s.messages.conversationId,
      conversationTitle: s.conversations.title,
      messagePublicId: s.messages.publicId,
      content: s.messages.content,
      createdAt: s.messages.createdAt,
    })
    .from(s.messages)
    .innerJoin(s.conversations, eq(s.messages.conversationId, s.conversations.id))
    .where(and(
      eq(s.conversations.userId, user.id),
      isNull(s.messages.deletedAt),
      like(s.messages.content, `%${kw}%`),
    ))
    .orderBy(desc(s.messages.createdAt))
    .limit(50);
  const typed = rows as Array<{ conversationId: string; conversationTitle: string | null; messagePublicId: string; content: unknown; createdAt: Date | number }>;
  return typed.map((r) => {
    const text = typeof r.content === "string" ? r.content : String(r.content ?? "");
    return {
      conversationId: r.conversationId,
      conversationTitle: r.conversationTitle ?? "(未命名)",
      messagePublicId: r.messagePublicId,
      snippet: makeSnippet(text, kw),
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
    };
  });
}

/** 截取 keyword 前后约 30 字符作为命中片段,首尾用省略号标记截断。 */
function makeSnippet(text: string, keyword: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + keyword.length + 30);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/** 一次性读回会话的输入区状态(模型 / 输出模式 / 输出样式 / 联网 / 指令卡 / 知识库),供 SSR 回填。 */
export async function getConversationComposerState(
  conversationId: string,
): Promise<ConversationComposerState> {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select({
      userId: S().conversations.userId,
      modelName: S().conversations.modelName,
      outputModeId: S().conversations.outputModeId,
      renderStyleId: S().conversations.renderStyleId,
      webSearch: S().conversations.webSearch,
      composerState: S().conversations.composerState,
    })
    .from(S().conversations)
    .where(eq(S().conversations.id, conversationId))
    .limit(1);
  if (!conv || conv.userId !== user.id) {
    return { modelName: null, outputModeId: null, renderStyleId: null, webSearch: false, cardIds: [], kbIds: [], temperature: null, topP: null, maxTokens: null, reasoning: null };
  }
  const composer = (conv.composerState as { cardIds?: string[]; kbIds?: string[]; temperature?: number; topP?: number; maxTokens?: number; reasoning?: ReasoningLevel } | null) ?? {};
  return {
    modelName: (conv.modelName as string | null) ?? null,
    outputModeId: (conv.outputModeId as string | null) ?? null,
    renderStyleId: (conv.renderStyleId as string | null) ?? null,
    webSearch: (conv.webSearch as boolean) ?? false,
    cardIds: composer.cardIds ?? [],
    kbIds: composer.kbIds ?? [],
    temperature: typeof composer.temperature === "number" ? composer.temperature : null,
    topP: typeof composer.topP === "number" ? composer.topP : null,
    maxTokens: typeof composer.maxTokens === "number" ? composer.maxTokens : null,
    reasoning: composer.reasoning ?? null,
  };
}

/** 删除会话。 */
export async function deleteConversation(id: string) {
  const user = await requireSession();
  const db = await getDb();
  // 确保属主
  const [conv] = await db
    .select({ userId: S().conversations.userId })
    .from(S().conversations)
    .where(eq(S().conversations.id, id))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.delete(S().conversations).where(eq(S().conversations.id, id));
  revalidatePath("/chat", "layout");
}

/** 重命名会话。 */
export async function renameConversation(id: string, title: string) {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select({ userId: S().conversations.userId })
    .from(S().conversations)
    .where(eq(S().conversations.id, id))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.update(S().conversations).set({ title, updatedAt: new Date() }).where(eq(S().conversations.id, id));
  revalidatePath("/chat", "layout");
}

/** 获取会话的消息(沿当前分支)。 */
export async function getMessages(conversationId: string) {
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select()
    .from(S().conversations)
    .where(eq(S().conversations.id, conversationId))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("会话不存在或无权访问");

  return db
    .select()
    .from(S().messages)
    .where(and(eq(S().messages.conversationId, conversationId), isNull(S().messages.deletedAt)))
    .orderBy(S().messages.createdAt);
}

/** P1-B:查询会话的全部 artifact(按 messageId 分组)。 */
export async function getArtifactsByConversation(conversationId: string): Promise<Record<string, ArtifactRow[]>> {
  const user = await requireSession();
  const db = await getDb();
  const rows = await db
    .select()
    .from(S().artifacts)
    .where(eq(S().artifacts.conversationId, conversationId));
  // 按 messageId 分组
  const map: Record<string, ArtifactRow[]> = {};
  for (const r of rows as ArtifactRow[]) {
    if (r.userId !== user.id) continue; // 属主校验
    const key = r.messageId;
    (map[key] ??= []).push({
      id: r.id,
      messageId: r.messageId,
      userId: r.userId,
      kind: r.kind,
      title: r.title,
      language: r.language,
      content: r.content,
    });
  }
  return map;
}

interface ArtifactRow {
  id: string;
  messageId: string;
  userId: string;
  kind: string;
  title: string;
  language: string | null;
  content: string;
}
