"use server";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import { findConversationMessage } from "@/lib/chat/message-reference";
import {
  normalizeMessageFeedback,
  type MessageFeedback,
} from "@/features/chat/model/feedback";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

/** UI 侧 ToolCallRecord 的 status 子集。 */
type ToolCallUiStatus = "calling" | "done" | "error";
type ToolCallRecord = { toolName: string; args?: unknown; status: ToolCallUiStatus };

/** DB tool_calls.status → UI ToolCallRecord.status。 */
function mapDbToolCallStatus(status: string): ToolCallUiStatus {
  if (status === "pending" || status === "running") return "calling";
  if (status === "failed") return "error";
  return "done";
}

/**
 * 按 runId 批量加载本会话的 tool_calls,映射为 UI ToolCallRecord。
 * 必须 join runs 并用 conversationId 限定,避免跨会话串数据。
 */
async function loadToolCallsByRunIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  conversationId: string,
  runIds: string[],
): Promise<Map<string, ToolCallRecord[]>> {
  const toolCallsByRunId = new Map<string, ToolCallRecord[]>();
  if (runIds.length === 0) return toolCallsByRunId;

  const toolRows = (await db
    .select({
      runId: s.toolCalls.runId,
      toolName: s.toolCalls.toolName,
      status: s.toolCalls.status,
      inputJson: s.toolCalls.inputJson,
      createdAt: s.toolCalls.createdAt,
    })
    .from(s.toolCalls)
    .innerJoin(s.runs, eq(s.toolCalls.runId, s.runs.runId))
    .where(and(eq(s.runs.conversationId, conversationId), inArray(s.toolCalls.runId, runIds)))
    .orderBy(s.toolCalls.createdAt)) as Array<{
    runId: string;
    toolName: string;
    status: string;
    inputJson: unknown;
    createdAt: string | Date;
  }>;

  for (const row of toolRows) {
    const rec: ToolCallRecord = {
      toolName: row.toolName,
      status: mapDbToolCallStatus(row.status),
    };
    // 仅恢复 inputJson 为 args;不向 UI 暴露 outputJson/errorJson
    if (row.inputJson !== undefined && row.inputJson !== null) {
      rec.args = row.inputJson;
    }
    const list = toolCallsByRunId.get(row.runId);
    if (list) list.push(rec);
    else toolCallsByRunId.set(row.runId, [rec]);
  }
  return toolCallsByRunId;
}

/**
 * 批量加载当前用户对指定消息的反馈。
 * 同时限定 userId + conversationId + messageIds,禁止跨会话。
 */
async function loadFeedbackByMessageIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  userId: string,
  conversationId: string,
  messageIds: string[],
): Promise<Map<string, MessageFeedback>> {
  const byMessageId = new Map<string, MessageFeedback>();
  if (messageIds.length === 0) return byMessageId;

  const rows = (await db
    .select({
      messageId: s.messageFeedback.messageId,
      rating: s.messageFeedback.rating,
      reason: s.messageFeedback.reason,
    })
    .from(s.messageFeedback)
    .where(
      and(
        eq(s.messageFeedback.userId, userId),
        eq(s.messageFeedback.conversationId, conversationId),
        inArray(s.messageFeedback.messageId, messageIds),
      ),
    )) as Array<{ messageId: string; rating: string; reason: string | null }>;

  for (const row of rows) {
    const feedback = normalizeMessageFeedback(row.rating, row.reason);
    if (feedback) byMessageId.set(row.messageId, feedback);
  }
  return byMessageId;
}

/**
 * 获取一条消息在分支树中的兄弟(同一 parent 下的其他 assistant 消息)。
 * 用于 UI 显示"还有 N 个其他回复"并切换。
 */
export async function getMessageSiblings(messagePublicId: string): Promise<{
  current: { publicId: string; parentId: string | null } | null;
  siblings: {
    publicId: string;
    content: string;
    reasoning: string | null;
    branchReason: string | null;
    toolCalls?: ToolCallRecord[];
    feedback?: MessageFeedback;
  }[];
}> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [msg] = await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.publicId, messagePublicId))
    .limit(1);
  if (!msg) return { current: null, siblings: [] };

  // 校验属主(通过 conversation)
  const [conv] = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.id, msg.conversationId))
    .limit(1);
  if (!conv || conv.userId !== user.id) return { current: null, siblings: [] };

  // 同 parentId 下的兄弟(含自己)。必须按 createdAt 升序,与 getVisibleBranch 的版本序号
  // 约定一致:否则无 ORDER BY 时 DB 返回顺序不定,会让版本切换器把最新版本算成第 1 个。
  const siblingsQuery = msg.parentId
    ? db.select().from(s.messages).where(and(eq(s.messages.parentId, msg.parentId), eq(s.messages.conversationId, msg.conversationId), isNull(s.messages.deletedAt))).orderBy(s.messages.createdAt)
    : db.select().from(s.messages).where(and(eq(s.messages.conversationId, msg.conversationId), isNull(s.messages.deletedAt))).orderBy(s.messages.createdAt);

  const all = (await siblingsQuery) as {
    id: string;
    publicId: string;
    parentId: string | null;
    content: string;
    reasoning: string | null;
    role: string;
    branchReason: string | null;
    runId: string | null;
  }[];
  const assistantSiblings = all.filter((m) => m.role === "assistant");

  // P1-B: 各兄弟版本按自身 runId 批量回填 toolCalls,切换版本时不丢工具记录。
  const runIds = Array.from(
    new Set(
      assistantSiblings
        .filter((m) => typeof m.runId === "string" && m.runId.length > 0)
        .map((m) => m.runId as string),
    ),
  );
  const toolCallsByRunId = await loadToolCallsByRunIds(db, s, msg.conversationId, runIds);

  // P2-A: 各兄弟版本批量回填当前用户 feedback。
  const siblingIds = assistantSiblings
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const feedbackByMessageId = await loadFeedbackByMessageIds(
    db,
    s,
    user.id,
    msg.conversationId,
    siblingIds,
  );

  const siblings = assistantSiblings.map((m) => {
    const base: {
      publicId: string;
      content: string;
      reasoning: string | null;
      branchReason: string | null;
      toolCalls?: ToolCallRecord[];
      feedback?: MessageFeedback;
    } = {
      publicId: m.publicId,
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      reasoning: m.reasoning,
      branchReason: m.branchReason,
    };
    if (typeof m.runId === "string") {
      const toolCalls = toolCallsByRunId.get(m.runId);
      if (toolCalls && toolCalls.length > 0) base.toolCalls = toolCalls;
    }
    const feedback = typeof m.id === "string" ? feedbackByMessageId.get(m.id) : undefined;
    if (feedback) base.feedback = feedback;
    return base;
  });

  return {
    current: { publicId: msg.publicId, parentId: msg.parentId },
    siblings,
  };
}

/**
 * 重新生成:从某条 assistant 消息的 parent(user 消息)重新生成。
 * 新 assistant 消息的 parentId = 原 user 消息,sourceId = 原 assistant 消息,branchReason="retry"。
 * 返回新消息的 publicId + 需要发送的请求信息(供前端调 /api/chat)。
 */
export async function retryFromMessage(
  conversationId: string,
  assistantPublicId: string,
): Promise<{
  newAssistantPublicId: string;
  parentPublicId: string | null;
  messages: { role: string; content: string }[];
}> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");

  const oldAssistant = await findConversationMessage(db, s, conversationId, { publicId: assistantPublicId });
  if (!oldAssistant) throw new Error("消息不存在");

  // 找到 parent(user 消息)的 publicId
  let parentPublicId: string | null = null;
  if (typeof oldAssistant.parentId === "string") {
    const parent = await findConversationMessage(db, s, conversationId, { id: oldAssistant.parentId });
    parentPublicId = typeof parent?.publicId === "string" ? parent.publicId : null;
  }

  // 构造历史:从会话开始到 parent(含)沿当前路径
  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt)) as {
    id: string;
    publicId: string;
    parentId: string | null;
    role: string;
    content: string;
  }[];

  // 沿 oldAssistant.parentId 向上追溯到根,构造路径
  const pathMsgs: typeof allMsgs = [];
  let cursorId = oldAssistant.parentId;
  while (cursorId) {
    const node = allMsgs.find((m) => m.id === cursorId);
    if (!node) break;
    pathMsgs.unshift(node);
    cursorId = node.parentId;
  }

  // 防御:目标 assistant 为孤儿(parentId 链断在根之上)时,历史路径为空。
  // 此时不允许重生成 —— 否则下游会拿到空 messages 数组,触发上游 400。
  if (pathMsgs.length === 0) {
    throw new Error("无法重生成:该消息缺少上级用户消息(数据异常)");
  }

  return {
    newAssistantPublicId: crypto.randomUUID(),
    parentPublicId,
    messages: pathMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
}

/**
 * 编辑用户消息后改写主线:原地修改该 user 消息内容,并递归删除其全部子树
 * (即原 AI 回答及之后的所有消息)。返回重生成所需的历史路径(不含被改写的消息本身,
 * 由调用方在 messages 末尾追加新内容)。
 *
 * 与分支模型不同:编辑是"改写主线"而非"新建分支",因此被编辑消息之后的内容会被
 * 物理删除。AI 回答的多版本能力由 regenerate(retry)分支提供。
 */
export async function editMessage(
  conversationId: string,
  messagePublicId: string,
  newContent: string,
): Promise<{
  messages: { role: string; content: string }[];
}> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");

  const oldMsg = await findConversationMessage(db, s, conversationId, { publicId: messagePublicId });
  if (!oldMsg) throw new Error("消息不存在");
  if (oldMsg.role !== "user") throw new Error("仅支持编辑用户消息");

  // 递归收集 oldMsg 的全部后代(原 AI 回答及其后续整段子树)。
  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt)) as {
    id: string;
    parentId: string | null;
  }[];

  const descendants: string[] = [];
  const queue = allMsgs.filter((m) => m.parentId === oldMsg.id).map((m) => m.id);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    descendants.push(cur);
    for (const m of allMsgs) {
      if (m.parentId === cur) queue.push(m.id);
    }
  }
  // 物理删除后代子树(artifacts 等依赖 messages 的表已配级联或按 messageId 关联,见 schema)
  if (descendants.length > 0) {
    await db.delete(s.messages).where(inArray(s.messages.id, descendants));
  }

  // 原地改写 user 消息内容,并清空其 fork 记录(改写主线后不再是任何分支的源)
  await db
    .update(s.messages)
    .set({ content: newContent, sourceId: null, branchReason: null })
    .where(eq(s.messages.id, oldMsg.id));

  // 构造重生成所需历史:沿 parentId 向上回溯到根,再追加改写后的新内容
  const pathMsgs: { role: string; content: string }[] = [];
  const pathIds: string[] = [];
  let cur: string | null = typeof oldMsg.parentId === "string" ? oldMsg.parentId : null;
  while (cur) {
    pathIds.unshift(cur);
    const node = allMsgs.find((m) => m.id === cur);
    cur = node?.parentId ?? null;
  }
  if (pathIds.length > 0) {
    const pathRows = (await db
      .select()
      .from(s.messages)
      .where(inArray(s.messages.id, pathIds))) as { id: string; role: string; content: string }[];
    // 按 pathIds 顺序排列
    const byId = new Map(pathRows.map((r) => [r.id, r]));
    for (const id of pathIds) {
      const r = byId.get(id);
      if (r) pathMsgs.push({ role: r.role, content: r.content });
    }
  }
  pathMsgs.push({ role: "user", content: newContent });

  return { messages: pathMsgs };
}

/**
 * 加载会话的"当前可见主线":从最新消息沿 parentId 回溯到根,得到默认展示的一条分支;
 * 并为每条 assistant 消息标注其同父兄弟数(>1 时前端显示版本切换器)。
 *
 * 编辑改写后旧子树已被物理删除,主线天然唯一;重生成产生的多个 assistant 兄弟里,
 * 默认取最新一条作为可见版本,其余可经切换器回看。
 */
export async function getVisibleBranch(conversationId: string): Promise<{
  messages: Record<string, unknown>[];
  /** key = assistant 消息 id,value = {current, total}(基于 createdAt 升序的序号)。 */
  versionMap: Record<string, { current: number; total: number }>;
}> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("会话不存在或无权访问");

  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt)) as Record<string, unknown>[];

  if (allMsgs.length === 0) return { messages: [], versionMap: {} };

  // 找最新叶子:没有其他消息以它为 parent 的节点中,createdAt 最大者。
  const parentIds = new Set(
    allMsgs.map((m) => m.parentId as string | null).filter((x): x is string => Boolean(x)),
  );
  const leaves = allMsgs.filter((m) => !parentIds.has(m.id as string));
  // 叶子中取 createdAt 最大;无叶子(理论上仅成环)退化为全量最后一条
  const latest = (leaves.length > 0 ? leaves : allMsgs).reduce((a, b) =>
    new Date(b.createdAt as string) > new Date(a.createdAt as string) ? b : a,
  );

  // 从 latest 沿 parentId 回溯到根,收集主线 id 集合
  const mainLineIds = new Set<string>();
  let cursor: string | null = latest.id as string;
  while (cursor) {
    if (mainLineIds.has(cursor)) break; // 防环
    mainLineIds.add(cursor);
    const node = allMsgs.find((m) => m.id === cursor);
    cursor = (node?.parentId as string | null) ?? null;
  }

  const mainMessages = allMsgs.filter((m) => mainLineIds.has(m.id as string));

  // 为每个主线上 assistant 的 parent 计算兄弟版本:统计同 parentId 的 assistant 数。
  // 主线上某 assistant 的可见版本 = 该 parentId 下 createdAt 最大的 assistant。
  const versionMap: Record<string, { current: number; total: number }> = {};
  // 按 parent 分组 assistant(全量,不限主线)
  const siblingsByParent = new Map<string, Record<string, unknown>[]>();
  for (const m of allMsgs) {
    if (m.role !== "assistant") continue;
    const pid = (m.parentId as string | null) ?? "__root__";
    (siblingsByParent.get(pid) ?? siblingsByParent.set(pid, []).get(pid)!).push(m);
  }
  // allMsgs 已按 createdAt 升序;每组里最后一条即最新版本
  for (const [, siblings] of siblingsByParent) {
    if (siblings.length <= 1) continue;
    const latestSibling = siblings[siblings.length - 1];
    versionMap[latestSibling.id as string] = { current: siblings.length, total: siblings.length };
  }

  // P1-B: 主线 assistant 的 MCP 工具调用按 runId 批量回填,刷新后恢复 toolCalls。
  // 必须 join runs 并用 conversationId 限定本会话,不能只按客户端/消息上的 runId 列表过滤。
  const runIds = Array.from(
    new Set(
      mainMessages
        .filter(
          (m) =>
            m.role === "assistant" &&
            typeof m.runId === "string" &&
            (m.runId as string).length > 0,
        )
        .map((m) => m.runId as string),
    ),
  );
  const toolCallsByRunId = await loadToolCallsByRunIds(db, s, conversationId, runIds);

  // P2-A: 主线消息批量回填当前用户 feedback(userId + conversationId + messageIds)。
  const mainMessageIds = mainMessages
    .map((m) => m.id as string)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const feedbackByMessageId = await loadFeedbackByMessageIds(
    db,
    s,
    user.id,
    conversationId,
    mainMessageIds,
  );

  const messages = mainMessages.map((m) => {
    let next = m;
    if (m.role === "assistant" && typeof m.runId === "string") {
      const toolCalls = toolCallsByRunId.get(m.runId);
      if (toolCalls && toolCalls.length > 0) next = { ...next, toolCalls };
    }
    const feedback = feedbackByMessageId.get(m.id as string);
    if (feedback) next = { ...next, feedback };
    return next;
  });

  return { messages, versionMap };
}

/**
 * 软删除一条用户消息:置 deletedAt=now。仅允许删除 user 消息,且会连带删除其对应的
 * AI 回复及之后整段子树(递归全部后代,含后续 user / assistant),避免遗留孤儿导致
 * 主线回溯断裂。返回被软删消息的 publicId 列表,供前端同步移除本地视图。
 */
export async function softDeleteMessage(messagePublicId: string): Promise<string[]> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [msg] = await db
    .select({
      id: s.messages.id,
      conversationId: s.messages.conversationId,
      role: s.messages.role,
    })
    .from(s.messages)
    .innerJoin(
      s.conversations,
      and(
        eq(s.conversations.id, s.messages.conversationId),
        eq(s.conversations.userId, user.id),
      ),
    )
    .where(eq(s.messages.publicId, messagePublicId))
    .limit(1);
  if (!msg) throw new Error("消息不存在");
  if (msg.role !== "user") throw new Error("仅支持删除用户消息");

  // 收集该 user 消息及其全部后代(对应 AI 回复 + 之后所有消息)
  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, msg.conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt)) as { id: string; publicId: string; parentId: string | null }[];

  const targetIds = new Set<string>([msg.id]);
  const queue = allMsgs.filter((m) => m.parentId === msg.id).map((m) => m.id);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    targetIds.add(cur);
    for (const m of allMsgs) {
      if (m.parentId === cur) queue.push(m.id);
    }
  }

  await db.update(s.messages).set({ deletedAt: new Date() }).where(inArray(s.messages.id, [...targetIds]));

  return allMsgs.filter((m) => targetIds.has(m.id)).map((m) => m.publicId);
}

/**
 * 继续生成:在某条 assistant 消息内容末尾续接生成。
 * 复用该 assistant 的 publicId(路由据此 update 同一行而非 insert 新行)。
 * 返回历史路径 + 末尾追加该 assistant 已有内容,作为 provider 的 assistant prefill。
 */
export async function continueMessage(
  conversationId: string,
  assistantPublicId: string,
): Promise<{
  assistantPublicId: string;
  parentPublicId: string | null;
  messages: { role: string; content: string }[];
}> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");

  const assistant = await findConversationMessage(db, s, conversationId, { publicId: assistantPublicId });
  if (!assistant) throw new Error("消息不存在");
  if (assistant.role !== "assistant") throw new Error("仅支持在 assistant 消息上继续生成");

  // 沿 parentId 回溯到根(含 user 父消息),构造历史路径
  let parentPublicId: string | null = null;
  if (typeof assistant.parentId === "string") {
    const parent = await findConversationMessage(db, s, conversationId, { id: assistant.parentId });
    parentPublicId = typeof parent?.publicId === "string" ? parent.publicId : null;
  }

  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
    .orderBy(s.messages.createdAt)) as {
    id: string;
    parentId: string | null;
    role: string;
    content: string;
  }[];

  const pathMsgs: typeof allMsgs = [];
  let cursorId = assistant.parentId;
  while (cursorId) {
    const node = allMsgs.find((m) => m.id === cursorId);
    if (!node) break;
    pathMsgs.unshift(node);
    cursorId = node.parentId;
  }
  if (pathMsgs.length === 0) {
    throw new Error("无法继续生成:该消息缺少上级用户消息(数据异常)");
  }

  // 末尾追加该 assistant 已有内容,作为 provider 的 assistant prefill(模型接着续写)
  const assistantText =
    typeof assistant.content === "string" ? assistant.content : String(assistant.content ?? "");
  const messages = [
    ...pathMsgs.map((m) => ({ role: m.role, content: m.content })),
    { role: "assistant", content: assistantText },
  ];

  return { assistantPublicId, parentPublicId, messages };
}
