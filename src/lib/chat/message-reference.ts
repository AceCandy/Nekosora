import { and, eq } from "drizzle-orm";

type MessageIdentifier = { publicId: string } | { id: string };

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
      ),
    )
    .limit(1);
  return message ?? null;
}
