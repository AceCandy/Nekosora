import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ op: "inArray", field, values })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
}));

vi.mock("drizzle-orm", () => mocks);

import {
  ChatAttachmentError,
  insertMessageAttachments,
  loadMessageAttachmentsByMessageIds,
  normalizeAttachmentFileIds,
  replaceMessageAttachments,
  resolveChatImageAttachments,
} from "@/lib/chat/message-attachments";

const schema = {
  fileObjects: {
    id: "files.id",
    userId: "files.userId",
    conversationId: "files.conversationId",
    filename: "files.filename",
    mime: "files.mime",
    storagePath: "files.storagePath",
  },
  messages: { id: "messages.id", conversationId: "messages.conversationId" },
  messageFileObjects: {
    messageId: "links.messageId",
    fileId: "links.fileId",
    sortOrder: "links.sortOrder",
  },
};

function selectRows(rows: Record<string, unknown>[]) {
  const query = {
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: Record<string, unknown>[]) => unknown) =>
      Promise.resolve(rows).then(resolve),
  };
  return vi.fn(() => ({ from: vi.fn(() => query) }));
}

describe("chat message attachments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("按首次出现位置去重 fileIds", () => {
    expect(normalizeAttachmentFileIds(["file-2", "file-1", "file-2"]))
      .toEqual(["file-2", "file-1"]);
    expect(() => normalizeAttachmentFileIds(["file-1", 2])).toThrow(ChatAttachmentError);
  });

  it("校验完整附件集合并恢复客户端顺序", async () => {
    const select = selectRows([
      { fileId: "file-1", filename: "one.png", mime: "image/png", storagePath: "one" },
      { fileId: "file-2", filename: "two.jpg", mime: "image/jpeg", storagePath: "two" },
    ]);
    const result = await resolveChatImageAttachments({ select }, schema, {
      userId: "user-1",
      conversationId: "conversation-1",
      fileIds: ["file-2", "file-1", "file-2"],
    });

    expect(result.map((item) => item.fileId)).toEqual(["file-2", "file-1"]);
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.userId, "user-1");
    expect(mocks.eq).toHaveBeenCalledWith(schema.fileObjects.conversationId, "conversation-1");
  });

  it("任一 ID 缺失或不是图片时拒绝整批", async () => {
    const missing = selectRows([
      { fileId: "file-1", filename: "one.png", mime: "image/png", storagePath: "one" },
    ]);
    await expect(resolveChatImageAttachments({ select: missing }, schema, {
      userId: "user-1",
      conversationId: "conversation-1",
      fileIds: ["file-1", "file-2"],
    })).rejects.toThrow(ChatAttachmentError);

    const nonImage = selectRows([
      { fileId: "file-1", filename: "notes.txt", mime: "text/plain", storagePath: "notes" },
    ]);
    await expect(resolveChatImageAttachments({ select: nonImage }, schema, {
      userId: "user-1",
      conversationId: "conversation-1",
      fileIds: ["file-1"],
    })).rejects.toThrow(ChatAttachmentError);
  });

  it("按 sortOrder 写入、替换并批量分组", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn(() => ({ where: deleteWhere }));
    const attachments = [
      { fileId: "file-2", filename: "two.png", mime: "image/png" },
      { fileId: "file-1", filename: "one.png", mime: "image/png" },
    ];

    await insertMessageAttachments({ insert }, schema, "message-1", attachments);
    expect(values).toHaveBeenCalledWith([
      { messageId: "message-1", fileId: "file-2", sortOrder: 0 },
      { messageId: "message-1", fileId: "file-1", sortOrder: 1 },
    ]);

    await replaceMessageAttachments({ insert, delete: remove }, schema, "message-1", attachments);
    expect(deleteWhere).toHaveBeenCalled();

    const select = selectRows([
      { messageId: "message-1", fileId: "file-2", filename: "two.png", mime: "image/png", storagePath: "two" },
      { messageId: "message-1", fileId: "file-1", filename: "one.png", mime: "image/png", storagePath: "one" },
      { messageId: "message-2", fileId: "file-3", filename: "three.png", mime: "image/png", storagePath: "three" },
    ]);
    const grouped = await loadMessageAttachmentsByMessageIds({ select }, schema, {
      userId: "user-1",
      conversationId: "conversation-1",
      messageIds: ["message-1", "message-2"],
    });
    expect(grouped.get("message-1")?.map((item) => item.fileId)).toEqual(["file-2", "file-1"]);
    expect(grouped.get("message-2")?.map((item) => item.fileId)).toEqual(["file-3"]);
  });
});
