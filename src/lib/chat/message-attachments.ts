import { and, eq, inArray, or } from "drizzle-orm";
import type { ChatMessageAttachment } from "@/features/chat/model/types";

export interface ResolvedChatImage extends ChatMessageAttachment {
  storagePath: string;
}

export function toChatMessageAttachments(
  attachments: ResolvedChatImage[],
): ChatMessageAttachment[] {
  return attachments.map(({ fileId, filename, mime }) => ({ fileId, filename, mime }));
}

export class ChatAttachmentError extends Error {
  readonly status = 400;
}

/** 客户端重复提交同一 ID 时保留第一次出现的位置。 */
export function normalizeAttachmentFileIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ChatAttachmentError("图片附件参数无效");

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new ChatAttachmentError("图片附件参数无效");
    }
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/** 一次性校验新消息附件的属主、会话归属和图片 MIME，并恢复客户端顺序。 */
export async function resolveChatImageAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  input: {
    userId: string;
    conversationId: string;
    fileIds: unknown;
  },
): Promise<ResolvedChatImage[]> {
  const fileIds = normalizeAttachmentFileIds(input.fileIds);
  if (fileIds.length === 0) return [];

  const rows = (await db
    .select({
      fileId: schema.fileObjects.id,
      filename: schema.fileObjects.filename,
      mime: schema.fileObjects.mime,
      storagePath: schema.fileObjects.storagePath,
    })
    .from(schema.fileObjects)
    .where(
      and(
        inArray(schema.fileObjects.id, fileIds),
        eq(schema.fileObjects.userId, input.userId),
        eq(schema.fileObjects.conversationId, input.conversationId),
      ),
    )) as ResolvedChatImage[];

  const byId = new Map(rows.map((row) => [row.fileId, row]));
  const ordered = fileIds.map((fileId) => byId.get(fileId));
  if (ordered.some((row) => !row || !row.mime.startsWith("image/"))) {
    throw new ChatAttachmentError("图片附件不存在、无权访问或不属于当前会话");
  }
  return ordered as ResolvedChatImage[];
}

/** 校验当前用户可见的模型确实支持图片输入。 */
export async function assertVisionModel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  input: { userId: string; model: string; modelId?: string },
): Promise<void> {
  const [modelRow] = input.modelId
    ? await db
        .select({ capabilities: schema.modelCatalog.capabilities })
        .from(schema.models)
        .innerJoin(schema.modelCatalog, eq(schema.models.catalogId, schema.modelCatalog.id))
        .where(
          and(
            eq(schema.models.id, input.modelId),
            eq(schema.models.enabled, true),
            or(eq(schema.models.visibility, "public"), eq(schema.models.ownerUserId, input.userId)),
          ),
        )
        .limit(1)
    : await db
        .select({ capabilities: schema.modelCatalog.capabilities })
        .from(schema.models)
        .innerJoin(schema.modelCatalog, eq(schema.models.catalogId, schema.modelCatalog.id))
        .where(
          and(
            eq(schema.models.name, input.model),
            eq(schema.models.enabled, true),
            or(eq(schema.models.visibility, "public"), eq(schema.models.ownerUserId, input.userId)),
          ),
        )
        .limit(1);
  const capabilities = modelRow?.capabilities as { vision?: boolean } | undefined;
  if (!capabilities?.vision) {
    throw new ChatAttachmentError("当前模型不支持图片输入(需 capabilities.vision=true)");
  }
}

export async function insertMessageAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  messageId: string,
  attachments: ChatMessageAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;
  await tx.insert(schema.messageFileObjects).values(
    attachments.map((attachment, sortOrder) => ({
      messageId,
      fileId: attachment.fileId,
      sortOrder,
    })),
  );
}

export async function replaceMessageAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  messageId: string,
  attachments: ChatMessageAttachment[],
): Promise<void> {
  await tx
    .delete(schema.messageFileObjects)
    .where(eq(schema.messageFileObjects.messageId, messageId));
  await insertMessageAttachments(tx, schema, messageId, attachments);
}

/** 批量投影当前用户会话中的消息附件，避免历史消息 N+1。 */
export async function loadMessageAttachmentsByMessageIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  input: { userId: string; conversationId: string; messageIds: string[] },
): Promise<Map<string, ResolvedChatImage[]>> {
  const result = new Map<string, ResolvedChatImage[]>();
  if (input.messageIds.length === 0) return result;

  const rows = (await db
    .select({
      messageId: schema.messageFileObjects.messageId,
      fileId: schema.fileObjects.id,
      filename: schema.fileObjects.filename,
      mime: schema.fileObjects.mime,
      storagePath: schema.fileObjects.storagePath,
    })
    .from(schema.messageFileObjects)
    .innerJoin(schema.messages, eq(schema.messageFileObjects.messageId, schema.messages.id))
    .innerJoin(schema.fileObjects, eq(schema.messageFileObjects.fileId, schema.fileObjects.id))
    .where(
      and(
        inArray(schema.messageFileObjects.messageId, input.messageIds),
        eq(schema.messages.conversationId, input.conversationId),
        eq(schema.fileObjects.userId, input.userId),
        eq(schema.fileObjects.conversationId, input.conversationId),
      ),
    )
    .orderBy(schema.messageFileObjects.messageId, schema.messageFileObjects.sortOrder)) as Array<
    ResolvedChatImage & { messageId: string }
  >;

  for (const row of rows) {
    if (!row.mime.startsWith("image/")) continue;
    const list = result.get(row.messageId);
    if (list) list.push(row);
    else result.set(row.messageId, [row]);
  }
  return result;
}
