import { and, eq, isNull } from "drizzle-orm";

type MessageIdentifier = { publicId: string } | { id: string };

/** 在当前用户拥有的会话行锁事务内执行消息树写入，避免同一会话的写操作交错。 */
export async function withConversationMessageWrite<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  conversationId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operation: (tx: any) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
  ) => {
    const [conversation] = await tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, conversationId),
          eq(schema.conversations.userId, userId),
        ),
      )
      .for("update");
    if (!conversation) return null;
    return operation(tx);
  });
}

/** 只在指定会话内解析消息引用，避免客户端 publicId 串联其他会话。 */
export async function findConversationMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  conversationId: string,
  identifier: MessageIdentifier,
): Promise<Record<string, unknown> | null> {
  const field = "publicId" in identifier ? schema.messages.publicId : schema.messages.id;
  const value = "publicId" in identifier ? identifier.publicId : identifier.id;
  const [message] = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(field, value),
        eq(schema.messages.conversationId, conversationId),
        isNull(schema.messages.deletedAt),
      ),
    )
    .limit(1);
  return message ?? null;
}
