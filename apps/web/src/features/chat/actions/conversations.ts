"use server";
import { eq, and, or, desc, isNull, isNotNull, asc, gt, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import { getConversationTitleState } from "@/lib/conversation-title/service";
import type { ReasoningLevel } from "@/db/types";
import {
  CONVERSATION_GROUP_KEYS,
  CONVERSATION_GROUP_PAGE_SIZE,
  CONVERSATION_PAGE_SIZE,
  type ConversationGroupBoundaries,
  type ConversationGroupKey,
  type ConversationGroupPage,
  type ConversationGroupSummary,
  type ConversationNavigationItem,
  type ConversationNavigationPage,
} from "@/features/chat/model/conversationNavigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activeRunExists(s: any) {
  return sql<boolean>`exists (
    select 1
    from ${s.runs}
    where ${s.runs.conversationId} = ${s.conversations.id}
      and ${s.runs.status} = 'running'
      and ${s.runs.leaseExpiresAt} > now()
  )`;
}

const conversationCursorSchema = z.object({
  rank: z.number().int().min(0).max(2),
  updatedAt: z.string().datetime({ precision: 6 }),
  id: z.string().min(1),
});

const conversationGroupBoundariesSchema = z.object({
  todayStart: z.string().datetime(),
  yesterdayStart: z.string().datetime(),
  dayBeforeYesterdayStart: z.string().datetime(),
  sevenDaysAgoStart: z.string().datetime(),
  thirtyDaysAgoStart: z.string().datetime(),
}).refine((value) => {
  const times = Object.values(value).map(Date.parse);
  return times.every((time, index) => index === 0 || times[index - 1] > time);
}, "会话分组时间边界无效");

const conversationGroupKeySchema = z.enum(CONVERSATION_GROUP_KEYS);
const conversationGroupCursorSchema = z.object({
  updatedAt: z.string().datetime({ precision: 6 }),
  id: z.string().min(1),
});

type ConversationGroupCursor = z.infer<typeof conversationGroupCursorSchema>;

type ConversationCursor = z.infer<typeof conversationCursorSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conversationRank(s: any) {
  return sql<number>`case
    when ${s.conversations.archived} then 2
    when ${s.conversations.pinned} then 0
    else 1
  end`;
}

function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeConversationCursor(cursor: string): ConversationCursor {
  try {
    if (cursor.length > 2048) throw new Error("cursor_too_long");
    return conversationCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("会话分页游标无效");
  }
}

function decodeConversationGroupCursor(cursor: string): ConversationGroupCursor {
  try {
    if (cursor.length > 2048) throw new Error("cursor_too_long");
    return conversationGroupCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("会话分组分页游标无效");
  }
}

function encodeConversationGroupCursor(cursor: ConversationGroupCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function toConversationNavigationItem(row: {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  generating: boolean;
  updatedAt: Date | number;
  sortUpdatedAt: string;
  rank: number;
}): ConversationNavigationItem {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    archived: row.archived,
    generating: row.generating,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : Number(row.updatedAt),
    sortUpdatedAt: row.sortUpdatedAt,
    rank: Number(row.rank),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conversationGroupWhere(s: any, key: ConversationGroupKey, boundaries: ConversationGroupBoundaries) {
  const active = and(eq(s.conversations.archived, false), eq(s.conversations.pinned, false));
  switch (key) {
    case "pinned": return and(eq(s.conversations.archived, false), eq(s.conversations.pinned, true));
    case "archived": return eq(s.conversations.archived, true);
    case "today": return and(active, sql`${s.conversations.updatedAt} >= ${boundaries.todayStart}::timestamptz`);
    case "yesterday": return and(active, sql`${s.conversations.updatedAt} >= ${boundaries.yesterdayStart}::timestamptz`, sql`${s.conversations.updatedAt} < ${boundaries.todayStart}::timestamptz`);
    case "dayBeforeYesterday": return and(active, sql`${s.conversations.updatedAt} >= ${boundaries.dayBeforeYesterdayStart}::timestamptz`, sql`${s.conversations.updatedAt} < ${boundaries.yesterdayStart}::timestamptz`);
    case "withinWeek": return and(active, sql`${s.conversations.updatedAt} >= ${boundaries.sevenDaysAgoStart}::timestamptz`, sql`${s.conversations.updatedAt} < ${boundaries.dayBeforeYesterdayStart}::timestamptz`);
    case "withinMonth": return and(active, sql`${s.conversations.updatedAt} >= ${boundaries.thirtyDaysAgoStart}::timestamptz`, sql`${s.conversations.updatedAt} < ${boundaries.sevenDaysAgoStart}::timestamptz`);
    case "earlier": return and(active, sql`${s.conversations.updatedAt} < ${boundaries.thirtyDaysAgoStart}::timestamptz`);
  }
}

/**
 * 有启用路由的 modelId 集合(CTE)。
 * innerJoin 它既保证模型至少有一条可用路由,又使每模型只匹配一行(无需再去重)。
 */
function routedModelIds(db: Awaited<ReturnType<typeof getDb>>) {
  return db
    .$with("routed_ids")
    .as(
      db
        .select({ modelId: S().routes.modelId })
        .from(S().routes)
        .where(eq(S().routes.enabled, true))
        .groupBy(S().routes.modelId),
    );
}

/**
 * 列出当前用户可见模型:visibility=public ∪ (private && owner=自己),且 enabled,
 * 且至少有一条启用路由(无路由或全禁用的模型不可用,不展示)。
 * 返回扁平 models 数组(带 id/ownerUserId/visibility/name/displayName/capabilities,供阶段3 前端用)。
 * private 排序在前(方言无关:JS 层稳定排序,组内保持 sortOrder)。
 */
export async function getVisibleModels() {
  const user = await requireSession();
  const db = await getDb();
  const routedIds = routedModelIds(db);
  const rows = await db
    .with(routedIds)
    .select({ model: S().models, capabilities: S().modelCatalog.capabilities })
    .from(S().models)
    .innerJoin(S().modelCatalog, eq(S().models.catalogId, S().modelCatalog.id))
    .innerJoin(routedIds, eq(routedIds.modelId, S().models.id))
    .where(
      and(
        or(eq(S().models.visibility, "public"), eq(S().models.ownerUserId, user.id)),
        eq(S().models.enabled, true),
      ),
    )
    .orderBy(asc(S().models.sortOrder), asc(S().models.createdAt));
  // private 排在前(public 在后)
  const models = rows.map((row: { model: Record<string, unknown>; capabilities: unknown }) => ({
    ...row.model,
    capabilities: row.capabilities,
  }));
  models.sort(
    (a: { visibility: unknown }, b: { visibility: unknown }) =>
      (a.visibility === "private" ? 0 : 1) - (b.visibility === "private" ? 0 : 1),
  );
  return models;
}

/**
 * 列出支持图像生成的可见模型(public ∪ 我的 private),按 capabilities.imageGeneration 过滤,
 * 且至少有一条启用路由(无路由或全禁用的模型不可用,不展示)。
 */
export async function getImageModels() {
  const user = await requireSession();
  const db = await getDb();
  const routedIds = routedModelIds(db);
  const rows = await db
    .with(routedIds)
    .select({ model: S().models, capabilities: S().modelCatalog.capabilities })
    .from(S().models)
    .innerJoin(S().modelCatalog, eq(S().models.catalogId, S().modelCatalog.id))
    .innerJoin(routedIds, eq(routedIds.modelId, S().models.id))
    .where(
      and(
        or(eq(S().models.visibility, "public"), eq(S().models.ownerUserId, user.id)),
        eq(S().models.enabled, true),
      ),
    )
    .orderBy(asc(S().models.sortOrder), asc(S().models.createdAt));
  const hasImg = (caps: unknown) =>
    Boolean((caps as { imageGeneration?: boolean } | null)?.imageGeneration);
  return rows
    .filter((row: { capabilities: unknown }) => hasImg(row.capabilities))
    .map((row: { model: Record<string, unknown>; capabilities: unknown }) => ({
      ...row.model,
      capabilities: row.capabilities,
    }));
}

/** 按侧栏展示顺序列出当前用户的一页会话。 */
export async function listConversations(cursor?: string | null): Promise<ConversationNavigationPage> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();
  const rank = conversationRank(s);
  const decoded = cursor ? decodeConversationCursor(cursor) : null;
  const cursorWhere = decoded
    ? or(
        gt(rank, decoded.rank),
        and(eq(rank, decoded.rank), lt(s.conversations.updatedAt, sql`${decoded.updatedAt}::timestamptz`)),
        and(
          eq(rank, decoded.rank),
          eq(s.conversations.updatedAt, sql`${decoded.updatedAt}::timestamptz`),
          lt(s.conversations.id, decoded.id),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      id: s.conversations.id,
      title: s.conversations.title,
      pinned: s.conversations.pinned,
      archived: s.conversations.archived,
      generating: activeRunExists(s),
      updatedAt: s.conversations.updatedAt,
      sortUpdatedAt: sql<string>`to_char(
        ${s.conversations.updatedAt} at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )`,
      rank,
    })
    .from(s.conversations)
    .where(and(eq(s.conversations.userId, user.id), cursorWhere))
    .orderBy(asc(rank), desc(s.conversations.updatedAt), desc(s.conversations.id))
    .limit(CONVERSATION_PAGE_SIZE + 1);

  const pageRows = rows.slice(0, CONVERSATION_PAGE_SIZE) as Array<
    Parameters<typeof toConversationNavigationItem>[0]
  >;
  const items = pageRows.map(toConversationNavigationItem);
  const last = pageRows.at(-1);
  return {
    items,
    nextCursor: rows.length > CONVERSATION_PAGE_SIZE && last
      ? encodeConversationCursor({
          rank: Number(last.rank),
          updatedAt: last.sortUpdatedAt,
          id: last.id,
        })
      : null,
  };
}

/** 返回各侧栏分组的真实总数，不加载会话正文。 */
export async function getConversationGroupSummary(
  input: ConversationGroupBoundaries,
): Promise<ConversationGroupSummary[]> {
  const boundaries = conversationGroupBoundariesSchema.parse(input);
  const user = await requireSession();
  const db = await getDb();
  const s = S();
  const projection = Object.fromEntries(CONVERSATION_GROUP_KEYS.map((key) => [
    key,
    sql<number>`count(*) filter (where ${conversationGroupWhere(s, key, boundaries)})`,
  ]));
  const [row] = await db
    .select(projection)
    .from(s.conversations)
    .where(eq(s.conversations.userId, user.id));
  return CONVERSATION_GROUP_KEYS.map((key) => ({ key, total: Number(row?.[key] ?? 0) }));
}

/** 按单个分组继续读取一页会话。 */
export async function listConversationGroup(
  groupInput: ConversationGroupKey,
  boundariesInput: ConversationGroupBoundaries,
  cursor?: string | null,
): Promise<ConversationGroupPage> {
  const key = conversationGroupKeySchema.parse(groupInput);
  const boundaries = conversationGroupBoundariesSchema.parse(boundariesInput);
  const decoded = cursor ? decodeConversationGroupCursor(cursor) : null;
  const user = await requireSession();
  const db = await getDb();
  const s = S();
  const rank = conversationRank(s);
  const cursorWhere = decoded
    ? or(
        lt(s.conversations.updatedAt, sql`${decoded.updatedAt}::timestamptz`),
        and(
          eq(s.conversations.updatedAt, sql`${decoded.updatedAt}::timestamptz`),
          lt(s.conversations.id, decoded.id),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      id: s.conversations.id,
      title: s.conversations.title,
      pinned: s.conversations.pinned,
      archived: s.conversations.archived,
      generating: activeRunExists(s),
      updatedAt: s.conversations.updatedAt,
      sortUpdatedAt: sql<string>`to_char(${s.conversations.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      rank,
    })
    .from(s.conversations)
    .where(and(
      eq(s.conversations.userId, user.id),
      conversationGroupWhere(s, key, boundaries),
      cursorWhere,
    ))
    .orderBy(desc(s.conversations.updatedAt), desc(s.conversations.id))
    .limit(CONVERSATION_GROUP_PAGE_SIZE + 1);
  const pageRows = rows.slice(0, CONVERSATION_GROUP_PAGE_SIZE) as Array<Parameters<typeof toConversationNavigationItem>[0]>;
  const last = pageRows.at(-1);
  return {
    key,
    items: pageRows.map(toConversationNavigationItem),
    nextCursor: rows.length > CONVERSATION_GROUP_PAGE_SIZE && last
      ? encodeConversationGroupCursor({ updatedAt: last.sortUpdatedAt, id: last.id })
      : null,
  };
}

/** 按 id 读取当前用户的一条侧栏会话投影，供深链补入首屏窗口。 */
export async function getConversationNavigationItem(
  conversationId: string,
): Promise<ConversationNavigationItem | null> {
  const id = z.string().min(1).parse(conversationId);
  const user = await requireSession();
  const db = await getDb();
  const s = S();
  const [row] = await db
    .select({
      id: s.conversations.id,
      title: s.conversations.title,
      pinned: s.conversations.pinned,
      archived: s.conversations.archived,
      generating: activeRunExists(s),
      updatedAt: s.conversations.updatedAt,
      sortUpdatedAt: sql<string>`to_char(
        ${s.conversations.updatedAt} at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )`,
      rank: conversationRank(s),
    })
    .from(s.conversations)
    .where(and(eq(s.conversations.id, id), eq(s.conversations.userId, user.id)))
    .limit(1);
  return row ? toConversationNavigationItem(row as Parameters<typeof toConversationNavigationItem>[0]) : null;
}

/** 轻量轮询接口:只返回当前用户仍有效的活动 run。 */
export async function getGeneratingStatuses() {
  const user = await requireSession();
  const db = await getDb();
  const s = S();
  const rows = await db
    .select({ id: s.runs.conversationId })
    .from(s.runs)
    .innerJoin(s.conversations, eq(s.runs.conversationId, s.conversations.id))
    .where(and(
      eq(s.conversations.userId, user.id),
      isNotNull(s.runs.conversationId),
      eq(s.runs.status, "running"),
      gt(s.runs.leaseExpiresAt, sql`now()`),
    ))
    .groupBy(s.runs.conversationId);
  return (rows as { id: string }[]).map(({ id }) => ({ id, generating: true as const }));
}

/** 供新会话短轮询的属主隔离标题状态。 */
export async function getConversationTitleStateAction(conversationId: string) {
  const user = await requireSession();
  return getConversationTitleState(user.id, conversationId);
}

/** 新会话首次发送时携带的输入区状态(已选输出模式 / 输出样式 / 联网 / 指令卡 / 知识库)。 */
export interface CreateConversationOptions {
  outputModeId?: string | null;
  renderStyleId?: string | null;
  webSearch?: boolean;
  cardIds?: string[];
  kbIds?: string[];
  reasoningByModelId?: Record<string, ReasoningLevel>;
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
      composerState: options && (options.cardIds?.length || options.kbIds?.length || options.reasoningByModelId)
        ? { cardIds: options.cardIds, kbIds: options.kbIds, reasoningByModelId: options.reasoningByModelId }
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

/** 会话级标题与输入区状态聚合视图(供 SSR 回填头部及选择器)。 */
export interface ConversationComposerState {
  title: string;
  modelName: string | null;
  outputModeId: string | null;
  renderStyleId: string | null;
  webSearch: boolean;
  cardIds: string[];
  kbIds: string[];
  reasoningByModelId: Record<string, ReasoningLevel>;
}

const reasoningLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const composerSnapshotSchema = z.object({
  modelName: z.string().min(1),
  outputModeId: z.string().min(1).nullable(),
  renderStyleId: z.string().min(1).nullable(),
  webSearch: z.boolean(),
  cardIds: z.array(z.string().min(1)),
  kbIds: z.array(z.string().min(1)),
  reasoningByModelId: z.record(z.string().min(1), reasoningLevelSchema),
});
const saveComposerSnapshotSchema = z.object({
  conversationId: z.string().min(1),
  snapshot: composerSnapshotSchema,
});

export type ConversationComposerSnapshotInput = z.input<typeof composerSnapshotSchema>;

/** 原子保存会话输入区完整快照，避免字段级请求与 JSON 读改写互相覆盖。 */
export async function saveConversationComposerState(
  conversationId: string,
  input: ConversationComposerSnapshotInput,
) {
  const parsed = saveComposerSnapshotSchema.safeParse({ conversationId, snapshot: input });
  if (!parsed.success) throw new Error("会话输入区状态无效");

  const user = await requireSession();
  const db = await getDb();
  const snapshot = parsed.data.snapshot;
  const rows = await db
    .update(S().conversations)
    .set({
      modelName: snapshot.modelName,
      outputModeId: snapshot.outputModeId,
      renderStyleId: snapshot.renderStyleId,
      webSearch: snapshot.webSearch,
      composerState: {
        cardIds: snapshot.cardIds,
        kbIds: snapshot.kbIds,
        reasoningByModelId: snapshot.reasoningByModelId,
      },
    })
    .where(and(
      eq(S().conversations.id, parsed.data.conversationId),
      eq(S().conversations.userId, user.id),
    ))
    .returning({ id: S().conversations.id });
  if (rows.length === 0) throw new Error("无权操作");
}

/**
 * 全文搜索当前用户会话的消息内容(jsonb 显式转 text 后使用 ILIKE)。
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
  const escapedKeyword = kw.replace(/[!%_]/g, "!$&");
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
      sql`${s.messages.content}::text ILIKE ${`%${escapedKeyword}%`} ESCAPE '!'`,
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
      title: S().conversations.title,
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
    return { title: "新会话", modelName: null, outputModeId: null, renderStyleId: null, webSearch: false, cardIds: [], kbIds: [], reasoningByModelId: {} };
  }
  const composer = (conv.composerState as { cardIds?: string[]; kbIds?: string[]; reasoningByModelId?: Record<string, ReasoningLevel> } | null) ?? {};
  return {
    title: conv.title,
    modelName: (conv.modelName as string | null) ?? null,
    outputModeId: (conv.outputModeId as string | null) ?? null,
    renderStyleId: (conv.renderStyleId as string | null) ?? null,
    webSearch: (conv.webSearch as boolean) ?? false,
    cardIds: composer.cardIds ?? [],
    kbIds: composer.kbIds ?? [],
    reasoningByModelId: composer.reasoningByModelId ?? {},
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
  const parsedId = z.string().min(1).parse(id);
  const parsedTitle = z.string().trim().min(1).max(200).parse(title);
  const user = await requireSession();
  const db = await getDb();
  const [conv] = await db
    .select({ userId: S().conversations.userId })
    .from(S().conversations)
    .where(eq(S().conversations.id, parsedId))
    .limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");
  await db.update(S().conversations).set({ title: parsedTitle, updatedAt: new Date() }).where(eq(S().conversations.id, parsedId));
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
