import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  isNull: vi.fn((field: unknown) => ({ op: "isNull", field })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  isNull: mocks.isNull,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { createShare, revokeShare } from "./share";

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

  it("创建分享时只记录当前会话中未删除的消息", async () => {
    const selectedRows = [
      [{ id: "conversation-1", userId: "user-1", title: "title", modelName: "model" }],
      [{ publicId: "visible-message" }],
    ];
    const values = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => selectReturning(selectedRows.shift() ?? [])),
      insert: vi.fn(() => ({ values })),
    });

    await createShare("conversation-1");

    expect(mocks.and).toHaveBeenCalledWith(
      { op: "eq", left: schema.messages.conversationId, right: "conversation-1" },
      { op: "isNull", field: schema.messages.deletedAt },
    );
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      messageIdsJson: ["visible-message"],
      defaultMessageIdsJson: ["visible-message"],
    }));
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
