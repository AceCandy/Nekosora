"use server";
import { eq } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import { requireSession } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = () => getSchema() as any;

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

  // 同 parentId 下的兄弟(含自己)
  const siblingsQuery = msg.parentId
    ? db.select().from(s.messages).where(eq(s.messages.parentId, msg.parentId))
    : db.select().from(s.messages).where(eq(s.messages.conversationId, msg.conversationId));

  const all = (await siblingsQuery) as {
    publicId: string;
    parentId: string | null;
    content: string;
    reasoning: string | null;
    role: string;
    branchReason: string | null;
  }[];
  const siblings = all.filter((m) => m.role === "assistant").map((m) => ({
    publicId: m.publicId,
    content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    reasoning: m.reasoning,
    branchReason: m.branchReason,
  }));

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

  const [oldAssistant] = await db.select().from(s.messages).where(eq(s.messages.publicId, assistantPublicId)).limit(1);
  if (!oldAssistant) throw new Error("消息不存在");

  // 找到 parent(user 消息)的 publicId
  let parentPublicId: string | null = null;
  if (oldAssistant.parentId) {
    const [parent] = await db.select().from(s.messages).where(eq(s.messages.id, oldAssistant.parentId)).limit(1);
    parentPublicId = parent?.publicId ?? null;
  }

  // 构造历史:从会话开始到 parent(含)沿当前路径
  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.conversationId, conversationId))
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

  return {
    newAssistantPublicId: crypto.randomUUID(),
    parentPublicId,
    messages: pathMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
}

/**
 * 编辑用户消息后重新生成:创建一条新 user 消息(sourceId 指向原 user 消息,branchReason="edit"),
 * 返回新消息信息供前端发送。
 */
export async function editMessage(
  conversationId: string,
  messagePublicId: string,
  newContent: string,
): Promise<{
  newUserPublicId: string;
  parentPublicId: string | null;
  messages: { role: string; content: string }[];
}> {
  const user = await requireSession();
  const db = await getDb();
  const s = S();

  const [conv] = await db.select().from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || conv.userId !== user.id) throw new Error("无权操作");

  const [oldMsg] = await db.select().from(s.messages).where(eq(s.messages.publicId, messagePublicId)).limit(1);
  if (!oldMsg) throw new Error("消息不存在");

  // 找到 parent 的 publicId(与 retryFromMessage 对齐,供前端作为 parentPublicId 传回)
  let parentPublicId: string | null = null;
  if (oldMsg.parentId) {
    const [parent] = await db.select().from(s.messages).where(eq(s.messages.id, oldMsg.parentId)).limit(1);
    parentPublicId = parent?.publicId ?? null;
  }

  // 构造历史路径(到 oldMsg 的 parent)
  const allMsgs = (await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.conversationId, conversationId))
    .orderBy(s.messages.createdAt)) as {
    id: string;
    publicId: string;
    parentId: string | null;
    role: string;
    content: string;
  }[];

  const pathMsgs: typeof allMsgs = [];
  let cursorId = oldMsg.parentId;
  while (cursorId) {
    const node = allMsgs.find((m) => m.id === cursorId);
    if (!node) break;
    pathMsgs.unshift(node);
    cursorId = node.parentId;
  }

  const newUserPublicId = crypto.randomUUID();
  return {
    newUserPublicId,
    parentPublicId,
    messages: [...pathMsgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: newContent }],
  };
}
