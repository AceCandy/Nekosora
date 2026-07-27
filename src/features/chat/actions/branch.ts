"use server";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";
import {
  findConversationMessage,
  withConversationMessageWrite,
} from "@/lib/chat/message-reference";
import {
  normalizeMessageFeedback,
  type MessageFeedback,
} from "@/features/chat/model/feedback";
import type { MessageVersionSelections } from "@/db/types";
import { resolveVisibleBranch } from "@/features/chat/lib/visible-branch";
import type { MessageRunMetadata } from "@/features/chat/model/types";

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

/** 按 runId 批量加载当前会话的可公开运行元数据。 */
async function loadRunMetadataByRunIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  conversationId: string,
  runIds: string[],
): Promise<Map<string, MessageRunMetadata>> {
  const byRunId = new Map<string, MessageRunMetadata>();
  if (runIds.length === 0) return byRunId;

  const rows = (await db
    .select({
      runId: s.runs.runId,
      model: s.runs.platformModelName,
      tokenUsage: s.runs.tokenUsage,
      durationMs: s.runs.durationMs,
      completedAt: s.runs.completedAt,
    })
    .from(s.runs)
    .where(
      and(
        eq(s.runs.conversationId, conversationId),
        inArray(s.runs.runId, runIds),
      ),
    )) as Array<{
    runId: string;
    model: string | null;
    tokenUsage: MessageRunMetadata["tokenUsage"] | null;
    durationMs: number | null;
    completedAt: Date | null;
  }>;

  for (const row of rows) {
    const metadata: MessageRunMetadata = {};
    if (row.model) metadata.model = row.model;
    if (row.tokenUsage != null) metadata.tokenUsage = row.tokenUsage;
    if (row.durationMs != null) metadata.durationMs = row.durationMs;
    if (row.completedAt) metadata.completedAt = row.completedAt.toISOString();
    if (Object.keys(metadata).length > 0) byRunId.set(row.runId, metadata);
  }
  return byRunId;
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
    runMetadata?: MessageRunMetadata;
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
    .where(and(eq(s.messages.publicId, messagePublicId), isNull(s.messages.deletedAt)))
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
  const runMetadataByRunId = await loadRunMetadataByRunIds(
    db,
    s,
    msg.conversationId,
    runIds,
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
      runMetadata?: MessageRunMetadata;
      toolCalls?: ToolCallRecord[];
      feedback?: MessageFeedback;
    } = {
      publicId: m.publicId,
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      reasoning: m.reasoning,
      branchReason: m.branchReason,
    };
    if (typeof m.runId === "string") {
      const runMetadata = runMetadataByRunId.get(m.runId);
      if (runMetadata) base.runMetadata = runMetadata;
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

/** 持久化当前会话选中的 assistant 消息版本。 */
export async function selectMessageVersion(messagePublicId: string): Promise<void> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  await db.transaction(async (tx: typeof db) => {
    const [message] = await tx
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.publicId, messagePublicId), isNull(s.messages.deletedAt)))
      .limit(1);
    if (!message || message.role !== "assistant") throw new Error("消息不存在");

    const [conversation] = await tx
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, message.conversationId))
      .limit(1)
      .for("update");
    if (!conversation || conversation.userId !== user.id) throw new Error("无权操作");

    const key = message.parentId ?? "__root__";
    const selections = (conversation.messageVersionSelections ?? {}) as MessageVersionSelections;
    await tx
      .update(s.conversations)
      .set({ messageVersionSelections: { ...selections, [key]: message.publicId } })
      .where(eq(s.conversations.id, message.conversationId));
  });
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

  const result = await withConversationMessageWrite(
    db,
    s,
    conversationId,
    user.id,
    async (tx) => {
      const oldMsg = await findConversationMessage(tx, s, conversationId, {
        publicId: messagePublicId,
      });
      if (!oldMsg) throw new Error("消息不存在");
      if (oldMsg.role !== "user") throw new Error("仅支持编辑用户消息");
      const oldMessageId = oldMsg.id as string;

      // 获锁后读取最新消息树，等待锁期间提交的新后代也会进入删除集合。
      const allMsgs = (await tx
        .select()
        .from(s.messages)
        .where(and(eq(s.messages.conversationId, conversationId), isNull(s.messages.deletedAt)))
        .orderBy(s.messages.createdAt)) as {
        id: string;
        parentId: string | null;
      }[];

      const descendants: string[] = [];
      const queue = allMsgs.filter((m) => m.parentId === oldMessageId).map((m) => m.id);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        descendants.push(cur);
        for (const m of allMsgs) {
          if (m.parentId === cur) queue.push(m.id);
        }
      }
      // 物理删除后代子树(artifacts 等依赖 messages 的表已配级联或按 messageId 关联,见 schema)
      if (descendants.length > 0) {
        await tx
          .delete(s.messages)
          .where(
            and(
              inArray(s.messages.id, descendants),
              eq(s.messages.conversationId, conversationId),
              isNull(s.messages.deletedAt),
            ),
          );
      }

      // 原地改写 user 消息内容,并清空其 fork 记录(改写主线后不再是任何分支的源)
      const [updated] = await tx
        .update(s.messages)
        .set({ content: newContent, sourceId: null, branchReason: null })
        .where(
          and(
            eq(s.messages.id, oldMessageId),
            eq(s.messages.conversationId, conversationId),
            eq(s.messages.role, "user"),
            isNull(s.messages.deletedAt),
          ),
        )
        .returning({ id: s.messages.id });
      if (!updated) throw new Error("消息已失效");

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
        const pathRows = (await tx
          .select()
          .from(s.messages)
          .where(
            and(
              inArray(s.messages.id, pathIds),
              eq(s.messages.conversationId, conversationId),
              isNull(s.messages.deletedAt),
            ),
          )) as { id: string; role: string; content: string }[];
        // 按 pathIds 顺序排列
        const byId = new Map(pathRows.map((r) => [r.id, r]));
        for (const id of pathIds) {
          const r = byId.get(id);
          if (r) pathMsgs.push({ role: r.role, content: r.content });
        }
      }
      pathMsgs.push({ role: "user", content: newContent });

      return { messages: pathMsgs };
    },
  );
  if (result === null) throw new Error("无权操作");
  return result;
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

  const { messages: mainMessages, versionMap } = resolveVisibleBranch(
    allMsgs,
    conv.messageVersionSelections as MessageVersionSelections | null,
  );

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
  const runMetadataByRunId = await loadRunMetadataByRunIds(
    db,
    s,
    conversationId,
    runIds,
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
      const runMetadata = runMetadataByRunId.get(m.runId);
      if (runMetadata) next = { ...next, runMetadata };
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
    .where(
      and(
        eq(s.messages.publicId, messagePublicId),
        isNull(s.messages.deletedAt),
      ),
    )
    .limit(1);
  if (!msg) throw new Error("消息不存在");
  if (msg.role !== "user") throw new Error("仅支持删除用户消息");

  const deletedPublicIds = await withConversationMessageWrite(
    db,
    s,
    msg.conversationId,
    user.id,
    async (tx) => {
      const current = await findConversationMessage(tx, s, msg.conversationId, {
        publicId: messagePublicId,
      });
      if (!current) throw new Error("消息不存在");
      if (current.role !== "user") throw new Error("仅支持删除用户消息");
      const currentId = current.id as string;

      // 获锁后读取最新树，确保等待期间提交的新子节点也被纳入。
      const allMsgs = (await tx
        .select()
        .from(s.messages)
        .where(and(eq(s.messages.conversationId, msg.conversationId), isNull(s.messages.deletedAt)))
        .orderBy(s.messages.createdAt)) as {
        id: string;
        publicId: string;
        parentId: string | null;
      }[];

      const targetIds = new Set<string>([currentId]);
      const queue = allMsgs.filter((m) => m.parentId === currentId).map((m) => m.id);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        targetIds.add(cur);
        for (const m of allMsgs) {
          if (m.parentId === cur) queue.push(m.id);
        }
      }

      const updated = (await tx
        .update(s.messages)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(s.messages.id, [...targetIds]),
            eq(s.messages.conversationId, msg.conversationId),
            isNull(s.messages.deletedAt),
          ),
        )
        .returning({ id: s.messages.id, publicId: s.messages.publicId })) as {
        id: string;
        publicId: string;
      }[];
      if (updated.length !== targetIds.size) throw new Error("消息树已发生变化");
      const updatedById = new Map(updated.map((row) => [row.id, row.publicId]));
      return allMsgs
        .filter((message) => targetIds.has(message.id))
        .map((message) => updatedById.get(message.id) ?? message.publicId);
    },
  );
  if (deletedPublicIds === null) throw new Error("消息不存在");
  return deletedPublicIds;
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
