import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { revokeShare } from "./share";

const schema = {
  conversations: { id: "conversations.id" },
  conversationShares: { shareId: "shares.shareId" },
};

function selectReturning(rows: Record<string, unknown>[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

describe("revokeShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
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
