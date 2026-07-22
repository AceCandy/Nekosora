import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and }));

import { findConversationMessage } from "@/lib/chat/message-reference";

const schema = {
  messages: {
    id: "messages.id",
    publicId: "messages.publicId",
    conversationId: "messages.conversationId",
  },
};

describe("findConversationMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockImplementation((left, right) => ({ op: "eq", left, right }));
    mocks.and.mockImplementation((...conditions) => ({ op: "and", conditions }));
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
    expect(where).toHaveBeenCalledWith(mocks.and.mock.results[0].value);
  });
});
