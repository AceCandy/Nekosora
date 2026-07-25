import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  isNull: vi.fn((field: unknown) => ({ op: "isNull", field })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ op: "inArray", field, values })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  isNull: mocks.isNull,
  inArray: mocks.inArray,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { createShare, getShare, revokeShare } from "./share";

const schema = {
  conversations: { id: "conversations.id" },
  conversationShares: { shareId: "shares.shareId" },
  messages: {
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
    deletedAt: "messages.deletedAt",
  },
};

function selectReturning(rows: Record<string, unknown>[]) {
  const query = {
    where: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return {
    from: vi.fn(() => query),
  };
}

describe("聊天分享动作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("创建分享时按客户端可见顺序记录指定消息", async () => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1", title: "title", modelName: "model" }],
      [{ publicId: "assistant-new" }, { publicId: "user-message" }],
    ];
    const values = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      insert: vi.fn(() => ({ values })),
    });

    await createShare("conversation-1", ["user-message", "assistant-new"]);

    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.messages.conversationId, right: "conversation-1" },
      { op: "isNull", field: schema.messages.deletedAt },
      {
        op: "inArray",
        field: schema.messages.publicId,
        values: ["user-message", "assistant-new"],
      },
    );
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      messageIdsJson: ["user-message", "assistant-new"],
      defaultMessageIdsJson: ["user-message", "assistant-new"],
    }));
  });

  it("任一可见消息不属于当前会话时整体拒绝", async () => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1", title: "title", modelName: "model" }],
      [{ publicId: "user-message" }],
    ];
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      insert,
    });

    await expect(createShare("conversation-1", ["user-message", "foreign-message"]))
      .rejects.toThrow("分享消息无效");

    expect(insert).not.toHaveBeenCalled();
  });

  it("可见消息列表为空时拒绝创建分享", async () => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1", title: "title", modelName: "model" }],
      [],
    ];
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      insert,
    });

    await expect(createShare("conversation-1", [])).rejects.toThrow("分享消息无效");

    expect(insert).not.toHaveBeenCalled();
  });

  it("可见消息列表包含重复 ID 时拒绝创建分享", async () => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1", title: "title", modelName: "model" }],
      [{ publicId: "same-message" }],
    ];
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      insert,
    });

    await expect(createShare("conversation-1", ["same-message", "same-message"]))
      .rejects.toThrow("分享消息无效");

    expect(insert).not.toHaveBeenCalled();
  });

  it("不能为其他用户的会话创建分享", async () => {
    const select = vi.fn(() => selectReturning([
      { id: "conversation-2", userId: "user-2", title: "foreign", modelName: "model" },
    ]));
    const insert = vi.fn();
    mocks.getDb.mockResolvedValue({ select, insert });

    await expect(createShare("conversation-2", ["foreign-message"]))
      .rejects.toThrow("无权操作");

    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("读取公开分享时排除已软删除的消息", async () => {
    const selectedRows = [
      [{
        shareId: "share-1",
        conversationId: "conversation-1",
        status: "active",
        revokedAt: null,
        titleSnapshot: "title",
        modelSnapshot: "model",
        messageIdsJson: ["assistant-message", "deleted-message", "user-message"],
      }],
      [
        { publicId: "user-message", role: "user", content: "question" },
        { publicId: "assistant-message", role: "assistant", content: "answer" },
      ],
    ];
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      update: vi.fn(() => ({ set })),
    });

    await expect(getShare("share-1")).resolves.toEqual({
      title: "title",
      model: "model",
      messages: [
        { role: "assistant", content: "answer" },
        { role: "user", content: "question" },
      ],
    });
    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.messages.conversationId, right: "conversation-1" },
      { op: "isNull", field: schema.messages.deletedAt },
    );
  });

  it("全部快照消息软删除后仍返回分享元数据", async () => {
    const selectedRows = [
      [{
        shareId: "share-1",
        conversationId: "conversation-1",
        status: "active",
        revokedAt: null,
        titleSnapshot: "title",
        modelSnapshot: "model",
        messageIdsJson: ["deleted-message"],
      }],
      [],
    ];
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      update: vi.fn(() => ({ set })),
    });

    await expect(getShare("share-1")).resolves.toEqual({
      title: "title",
      model: "model",
      messages: [],
    });
    expect(set).toHaveBeenCalledWith({ lastAccessedAt: expect.any(Date) });
    expect(where).toHaveBeenCalledWith(
      { op: "eq", left: schema.conversationShares.shareId, right: "share-1" },
    );
  });

  it("不能撤销其他用户会话的分享", async () => {
    const selectedRows = [
      [{ shareId: "share-1", conversationId: "conversation-2" }],
      [{ id: "conversation-2", userId: "user-2" }],
    ];
    const update = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      update,
    });

    await expect(revokeShare("share-1")).rejects.toThrow("无权操作");
    expect(update).not.toHaveBeenCalled();
  });

  it("允许会话属主撤销自己的分享", async () => {
    const selectedRows = [
      [{ shareId: "share-1", conversationId: "conversation-1" }],
      [{ id: "conversation-1", userId: "user-1" }],
    ];
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      update,
    });

    await expect(revokeShare("share-1")).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(schema.conversationShares);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "revoked" }));
    expect(where).toHaveBeenCalledTimes(1);
  });
});
