import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn(),
  or: vi.fn(),
  desc: vi.fn((field: unknown) => ({ op: "desc", field })),
  isNull: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    text: strings.join("?"),
    values,
  })),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  or: mocks.or,
  desc: mocks.desc,
  isNull: mocks.isNull,
  asc: mocks.asc,
  sql: mocks.sql,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));

import { getGeneratingStatuses, listConversations } from "./conversations";

const schema = {
  conversations: {
    id: "conversations.id",
    title: "conversations.title",
    pinned: "conversations.pinned",
    archived: "conversations.archived",
    generating: "conversations.generating",
    updatedAt: "conversations.updatedAt",
    userId: "conversations.userId",
  },
  runs: {
    conversationId: "runs.conversationId",
    status: "runs.status",
    leaseExpiresAt: "runs.leaseExpiresAt",
  },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    then: (
      resolve: (value: Record<string, unknown>[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

describe("会话 generating 派生", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("列表与轮询都从 fresh running runs 派生而不读取 legacy boolean", async () => {
    const projections: Array<Record<string, unknown>> = [];
    const resultSets = [
      [{ id: "conversation-1", generating: true }],
      [{ id: "conversation-1", generating: true }],
    ];
    const db = {
      select: vi.fn((projection: Record<string, unknown>) => {
        projections.push(projection);
        return queryReturning(resultSets.shift() ?? []);
      }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(listConversations()).resolves.toEqual([
      { id: "conversation-1", generating: true },
    ]);
    await expect(getGeneratingStatuses()).resolves.toEqual([
      { id: "conversation-1", generating: true },
    ]);

    const [listGenerating, statusGenerating] = projections.map(
      (projection) => projection.generating,
    );
    expect(listGenerating).not.toBe(schema.conversations.generating);
    expect(statusGenerating).toEqual(listGenerating);
    expect(listGenerating).toEqual(expect.objectContaining({
      op: "sql",
      text: expect.stringMatching(/exists[\s\S]*running[\s\S]*now\(\)/),
      values: expect.arrayContaining([
        schema.runs.conversationId,
        schema.conversations.id,
        schema.runs.status,
        schema.runs.leaseExpiresAt,
      ]),
    }));
  });
});
