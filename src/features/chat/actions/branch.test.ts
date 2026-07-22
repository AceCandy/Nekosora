import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  findConversationMessage: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  isNull: vi.fn((field: unknown) => ({ op: "isNull", field })),
  inArray: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  isNull: mocks.isNull,
  inArray: mocks.inArray,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/lib/chat/message-reference", () => ({
  findConversationMessage: mocks.findConversationMessage,
}));

import { continueMessage, editMessage, getMessageSiblings, retryFromMessage } from "./branch";

const schema = {
  conversations: { id: "conversations.id" },
  messages: {
    id: "messages.id",
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
    parentId: "messages.parentId",
    createdAt: "messages.createdAt",
    deletedAt: "messages.deletedAt",
  },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(rows.slice(0, 1))),
    orderBy: vi.fn(() => Promise.resolve(rows)),
  };
  return query;
}

describe("聊天分支消息属主隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("编辑时拒绝当前会话之外的消息且不执行写操作", async () => {
    const update = vi.fn();
    const remove = vi.fn();
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => queryReturning([
        { id: "conversation-1", userId: "user-1" },
      ])) })),
      update,
      delete: remove,
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage.mockResolvedValue(null);

    await expect(editMessage("conversation-1", "foreign-message", "new content"))
      .rejects.toThrow("消息不存在");

    expect(mocks.findConversationMessage).toHaveBeenCalledWith(
      db,
      schema,
      "conversation-1",
      { publicId: "foreign-message" },
    );
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("查询同父兄弟时额外限制消息所属会话", async () => {
    const selectRows = [
      [{ id: "assistant-1", publicId: "public-1", conversationId: "conversation-1", parentId: "parent-1" }],
      [{ id: "conversation-1", userId: "user-1" }],
      [],
    ];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => queryReturning(selectRows.shift() ?? [])),
      })),
    };
    mocks.getDb.mockResolvedValue(db);

    await getMessageSiblings("public-1");

    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.conversationId, "conversation-1");
  });

  it.each([
    ["重试", retryFromMessage],
    ["续写", continueMessage],
  ])("%s 时在当前会话内解析 assistant 及其父消息", async (_name, action) => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1" }],
      [{ id: "parent-1", publicId: "parent-public-1", parentId: null, role: "user", content: "hello" }],
    ];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => queryReturning(selectedRows.shift() ?? [])),
      })),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.findConversationMessage
      .mockResolvedValueOnce({
        id: "assistant-1",
        publicId: "assistant-public-1",
        parentId: "parent-1",
        role: "assistant",
        content: "response",
      })
      .mockResolvedValueOnce({
        id: "parent-1",
        publicId: "parent-public-1",
        role: "user",
      });

    await action("conversation-1", "assistant-public-1");

    expect(mocks.findConversationMessage).toHaveBeenNthCalledWith(
      1,
      db,
      schema,
      "conversation-1",
      { publicId: "assistant-public-1" },
    );
    expect(mocks.findConversationMessage).toHaveBeenNthCalledWith(
      2,
      db,
      schema,
      "conversation-1",
      { id: "parent-1" },
    );
  });
});
