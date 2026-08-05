import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { setMessageFeedback } from "./feedback";

const schema = {
  conversations: { id: "conversations.id" },
  messages: {
    id: "messages.id",
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
    deletedAt: "messages.deletedAt",
    role: "messages.role",
  },
  messageFeedback: {
    userId: "messageFeedback.userId",
    messageId: "messageFeedback.messageId",
    conversationId: "messageFeedback.conversationId",
    rating: "messageFeedback.rating",
    reason: "messageFeedback.reason",
    updatedAt: "messageFeedback.updatedAt",
  },
};

function selectReturning(rows: Record<string, unknown>[]) {
  const query = {
    where: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return { from: vi.fn(() => query) };
}

function makeDb(opts: {
  selectRows: Record<string, unknown>[][];
  insert?: ReturnType<typeof vi.fn>;
  deleteWhere?: ReturnType<typeof vi.fn>;
}) {
  const queue = [...opts.selectRows];
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = opts.insert ?? vi.fn(() => ({ values }));
  const deleteWhere = opts.deleteWhere ?? vi.fn().mockResolvedValue(undefined);
  const del = vi.fn(() => ({ where: deleteWhere }));
  return {
    db: {
      select: vi.fn(() => selectReturning(queue.shift() ?? [])),
      insert,
      delete: del,
    },
    insert,
    values,
    onConflictDoUpdate,
    deleteWhere,
    del,
  };
}

const assistantMsg = {
  id: "msg-1",
  publicId: "pub-asst-1",
  conversationId: "conversation-1",
  role: "assistant",
  deletedAt: null,
  content: "answer body should never be written to feedback",
};

describe("setMessageFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("upsert up 并清空 reason", async () => {
    const { db, values, onConflictDoUpdate } = makeDb({
      selectRows: [[assistantMsg], [{ id: "conversation-1", userId: "user-1" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    const result = await setMessageFeedback("pub-asst-1", "up", "incorrect");

    expect(result).toEqual({ rating: "up" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg-1",
        conversationId: "conversation-1",
        userId: "user-1",
        rating: "up",
        reason: null,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [schema.messageFeedback.userId, schema.messageFeedback.messageId],
        set: expect.objectContaining({ rating: "up", reason: null }),
      }),
    );
    // 不把回答正文写入反馈
    const inserted = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted).not.toHaveProperty("content");
  });

  it("upsert down 可带 reason", async () => {
    const { db, values } = makeDb({
      selectRows: [[assistantMsg], [{ id: "conversation-1", userId: "user-1" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    const result = await setMessageFeedback("pub-asst-1", "down", "outdated");

    expect(result).toEqual({ rating: "down", reason: "outdated" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ rating: "down", reason: "outdated" }),
    );
  });

  it("rating=null 删除当前用户该消息反馈", async () => {
    const { db, deleteWhere, insert } = makeDb({
      selectRows: [[assistantMsg], [{ id: "conversation-1", userId: "user-1" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    const result = await setMessageFeedback("pub-asst-1", null);

    expect(result).toBeNull();
    expect(deleteWhere).toHaveBeenCalled();
    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.messageFeedback.userId, right: "user-1" },
      { op: "eq", left: schema.messageFeedback.messageId, right: "msg-1" },
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("非法 reason 拒绝写入", async () => {
    const { db, insert } = makeDb({
      selectRows: [[assistantMsg], [{ id: "conversation-1", userId: "user-1" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(
      setMessageFeedback("pub-asst-1", "down", "spam" as "other"),
    ).rejects.toThrow("非法反馈原因");
    expect(insert).not.toHaveBeenCalled();
  });

  it("非法 rating 拒绝写入", async () => {
    const { db, insert } = makeDb({
      selectRows: [[assistantMsg], [{ id: "conversation-1", userId: "user-1" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(
      setMessageFeedback("pub-asst-1", "sideways" as "up"),
    ).rejects.toThrow("非法反馈评分");
    expect(insert).not.toHaveBeenCalled();
  });

  it("非 assistant 统一无权且不写入", async () => {
    const { db, insert } = makeDb({
      selectRows: [
        [{ ...assistantMsg, role: "user" }],
        [{ id: "conversation-1", userId: "user-1" }],
      ],
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(setMessageFeedback("pub-asst-1", "up")).rejects.toThrow("无权操作");
    expect(insert).not.toHaveBeenCalled();
  });

  it("越权(他会话属主)统一无权且不泄露", async () => {
    const { db, insert, del } = makeDb({
      selectRows: [[assistantMsg], [{ id: "conversation-1", userId: "other-user" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(setMessageFeedback("pub-asst-1", "up")).rejects.toThrow("无权操作");
    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("消息不存在与越权同错误文案", async () => {
    const { db, insert } = makeDb({ selectRows: [[]] });
    mocks.getDb.mockResolvedValue(db);

    await expect(setMessageFeedback("missing", "up")).rejects.toThrow("无权操作");
    expect(insert).not.toHaveBeenCalled();
  });

  it("已删除消息不可反馈", async () => {
    const { db, insert } = makeDb({
      selectRows: [[{ ...assistantMsg, deletedAt: "2026-07-25T00:00:00.000Z" }]],
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(setMessageFeedback("pub-asst-1", "down")).rejects.toThrow("无权操作");
    expect(insert).not.toHaveBeenCalled();
  });
});
