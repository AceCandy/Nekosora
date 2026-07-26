import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and, isNull: mocks.isNull }));

import {
  findConversationMessage,
  withConversationMessageWrite,
} from "@/lib/chat/message-reference";

const schema = {
  conversations: {
    id: "conversations.id",
    userId: "conversations.userId",
  },
  messages: {
    id: "messages.id",
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
    deletedAt: "messages.deletedAt",
  },
};

describe("findConversationMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
    mocks.isNull.mockImplementation((field) => ({ op: "isNull", field }));
  });

  it.each([
    [{ publicId: "public-1" }, schema.messages.publicId, "public-1"],
    [{ id: "internal-1" }, schema.messages.id, "internal-1"],
  ])("identifier=%j 时同时限制 conversationId", async (identifier, field, value) => {
    const limit = vi.fn().mockResolvedValue([{ id: "message-1" }]);
    const where = vi.fn(() => ({ limit }));
    const db = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    };

    await expect(
      findConversationMessage(db, schema, "conversation-1", identifier),
    ).resolves.toMatchObject({ id: "message-1" });

    expect(mocks.eq).toHaveBeenCalledWith(field, value);
    expect(mocks.eq).toHaveBeenCalledWith(schema.messages.conversationId, "conversation-1");
    expect(mocks.isNull).toHaveBeenCalledWith(schema.messages.deletedAt);
    expect(where).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: field, right: value },
        { op: "eq", left: schema.messages.conversationId, right: "conversation-1" },
        { op: "isNull", field: schema.messages.deletedAt },
      ],
    });
  });

  it("在属主会话行锁事务内执行消息写回调", async () => {
    const lock = vi.fn().mockResolvedValue([{ id: "conversation-1" }]);
    const where = vi.fn(() => ({ for: lock }));
    const tx = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    };
    const transaction = vi.fn(
      async (operation: (transactionDb: typeof tx) => Promise<unknown>) => operation(tx),
    );
    const operation = vi.fn(async (transactionDb: typeof tx) => {
      expect(transactionDb).toBe(tx);
      return "written";
    });

    await expect(
      withConversationMessageWrite(
        { transaction },
        schema,
        "conversation-1",
        "user-1",
        operation,
      ),
    ).resolves.toBe("written");

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith("update");
    expect(where).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.conversations.id, right: "conversation-1" },
        { op: "eq", left: schema.conversations.userId, right: "user-1" },
      ],
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("属主会话未命中时不执行消息写回调", async () => {
    const lock = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ for: lock }));
    const tx = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
    };
    const transaction = vi.fn(
      async (operation: (transactionDb: typeof tx) => Promise<unknown>) => operation(tx),
    );
    const operation = vi.fn();

    await expect(
      withConversationMessageWrite(
        { transaction },
        schema,
        "conversation-1",
        "other-user",
        operation,
      ),
    ).resolves.toBeNull();

    expect(lock).toHaveBeenCalledWith("update");
    expect(operation).not.toHaveBeenCalled();
  });
});
