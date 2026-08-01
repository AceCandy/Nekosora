import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  inArray: vi.fn((left: unknown, right: unknown) => ({ op: "inArray", left, right })),
  passthrough: vi.fn((...args: unknown[]) => ({ args })),
  sql: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  inArray: mocks.inArray,
  gte: mocks.passthrough,
  lte: mocks.passthrough,
  desc: mocks.passthrough,
  isNotNull: mocks.passthrough,
  ilike: mocks.passthrough,
  or: mocks.passthrough,
  sql: mocks.sql,
}));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));

import { listAttemptsByRequestIds } from "./error-log-repository";

const schema = {
  gatewayAttempts: {
    executionId: "attempts.executionId",
    status: "attempts.status",
  },
  gatewayExecutions: {
    id: "executions.id",
    requestId: "executions.requestId",
    apiKeyId: "executions.apiKeyId",
    userId: "executions.userId",
  },
  apiKeys: { id: "apiKeys.id", name: "apiKeys.name" },
  user: { id: "user.id", name: "user.name", email: "user.email" },
};

function createSelectQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn().mockResolvedValue(rows),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  return query;
}

describe("error log repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = createSelectQuery([]);
    mocks.getDb.mockResolvedValue({ select: vi.fn(() => query) });
    mocks.getSchema.mockReturnValue(schema);
  });

  it("attempt chain 只查询失败类尝试并保持用户隔离", async () => {
    await listAttemptsByRequestIds(["request-1"], "user-1");

    expect(mocks.inArray).toHaveBeenCalledWith(
      schema.gatewayExecutions.requestId,
      ["request-1"],
    );
    expect(mocks.inArray).toHaveBeenCalledWith(
      schema.gatewayAttempts.status,
      ["failed", "interrupted", "rejected"],
    );
    expect(mocks.eq).toHaveBeenCalledWith(schema.gatewayExecutions.userId, "user-1");
  });
});
