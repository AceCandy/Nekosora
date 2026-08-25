import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ op: "inArray", left, right })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and, inArray: mocks.inArray }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));

import { deleteCard, getCardsByIds, listCards, updateCard } from "./service";

const schema = {
  instructionCards: {
    id: "instructionCards.id",
    userId: "instructionCards.userId",
    enabled: "instructionCards.enabled",
    sortOrder: "instructionCards.sortOrder",
    title: "instructionCards.title",
  },
};

const row = {
  id: "card-1",
  userId: "user-1",
  trigger: "translate",
  title: "Translator",
  description: null,
  markdown: "Translate the input.",
  enabled: true,
  sortOrder: 0,
  useCount: 0,
};

describe("instruction cards ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("列表和聊天按 ID 查询都限定当前用户", async () => {
    const orderBy = vi.fn().mockResolvedValue([row]);
    const where = vi.fn()
      .mockReturnValueOnce({ orderBy })
      .mockResolvedValueOnce([row]);
    const from = vi.fn(() => ({ where }));
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => ({ from })) });

    await listCards("user-1");
    await getCardsByIds("user-1", ["card-1"]);

    expect(where).toHaveBeenNthCalledWith(1, {
      op: "and",
      conditions: [
        { op: "eq", left: schema.instructionCards.enabled, right: true },
        { op: "eq", left: schema.instructionCards.userId, right: "user-1" },
      ],
    });
    expect(where).toHaveBeenNthCalledWith(2, {
      op: "and",
      conditions: [
        { op: "inArray", left: schema.instructionCards.id, right: ["card-1"] },
        { op: "eq", left: schema.instructionCards.enabled, right: true },
        { op: "eq", left: schema.instructionCards.userId, right: "user-1" },
      ],
    });
  });

  it("拒绝修改或删除他人的指令卡", async () => {
    const limit = vi.fn().mockResolvedValue([{ ...row, userId: "user-2" }]);
    const where = vi.fn(() => ({ limit }));
    const update = vi.fn();
    const remove = vi.fn();
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
      update,
      delete: remove,
    });

    await expect(updateCard("user-1", "card-1", { title: "Changed" }))
      .rejects.toThrow("无权修改他人指令卡");
    await expect(deleteCard("user-1", "card-1"))
      .rejects.toThrow("无权删除他人指令卡");
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
