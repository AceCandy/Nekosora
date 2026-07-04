"use server";
import { eq, and, desc, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/** 列出当前用户可见模型(全局 public ∪ 我的 BYO)。 */
export async function getVisibleModels() {
  const user = await requireSession();
  const db = await getDb();
  const [globals, byos] = await Promise.all([
    db
      .select()
      .from(S().globalModels)
      .where(and(eq(S().globalModels.accessScope, "public"), eq(S().globalModels.enabled, true)))
      .orderBy(S().globalModels.sortOrder),
    db
      .select({ model: S().userModels, providerName: S().userProviders.name })
      .from(S().userModels)
      .innerJoin(S().userProviders, eq(S().userModels.providerId, S().userProviders.id))
      .where(and(eq(S().userModels.userId, user.id), eq(S().userModels.enabled, true))),
  ]);
  return { globals: globals as Record<string, unknown>[], byos: byos as Record<string, unknown>[] };
}

/** 列出支持图像生成的可见模型(global public ∪ BYO,按 capabilities.imageGeneration 过滤)。 */
export async function getImageModels() {
  const user = await requireSession();
  const db = await getDb();
  const [globals, byos] = await Promise.all([
    db
      .select({ name: S().globalModels.name, displayName: S().globalModels.displayName, capabilities: S().globalModels.capabilities })
      .from(S().globalModels)
      .where(and(eq(S().globalModels.accessScope, "public"), eq(S().globalModels.enabled, true)))
      .orderBy(S().globalModels.sortOrder),
    db
      .select({ name: S().userModels.name, capabilities: S().userModels.capabilities })
      .from(S().userModels)
      .where(eq(S().userModels.userId, user.id)),
  ]);
  const hasImg = (caps: unknown) => Boolean((caps as { imageGeneration?: boolean } | null)?.imageGeneration);
  return {
    globals: (globals as Record<string, unknown>[]).filter((m) => hasImg(m.capabilities)),
    byos: (byos as Record<string, unknown>[]).filter((m) => hasImg(m.capabilities)),
  };
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

/** 新会话首次发送时携带的输入区状态(已选输出方式 / 输出样式 / 联网 / 指令卡 / 知识库)。 */
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

/** 设置会话的输出方式(null 表示清除,回到普通对话)。 */
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
  params: { temperature?: number | null; topP?: number | null; maxTokens?: number | null },
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

/** 一次性读回会话的输入区状态(模型 / 输出方式 / 输出样式 / 联网 / 指令卡 / 知识库),供 SSR 回填。 */
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
    return { modelName: null, outputModeId: null, renderStyleId: null, webSearch: false, cardIds: [], kbIds: [], temperature: null, topP: null, maxTokens: null };
  }
  const composer = (conv.composerState as { cardIds?: string[]; kbIds?: string[]; temperature?: number; topP?: number; maxTokens?: number } | null) ?? {};
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
