import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  extractMemories: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("./extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extract")>();
  return { ...actual, extractMemories: mocks.extractMemories };
});

import { createMemoryExtractionJob, processMemoryExtractionJob } from "./jobs";

const schema = {
  memoryExtractionJobs: {
    id: "jobs.id",
    userId: "jobs.userId",
    conversationId: "jobs.conversationId",
    messages: "jobs.messages",
  },
};

function createDb(job?: Record<string, unknown>) {
  const limit = vi.fn().mockResolvedValue(job ? [job] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const db = {
    select: vi.fn(() => ({ from })),
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  return { db, deleteWhere };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSchema.mockReturnValue(schema);
  mocks.extractMemories.mockResolvedValue(undefined);
});

describe("memory extraction jobs", () => {
  it("构造 run 唯一的最小消息快照", () => {
    const job = createMemoryExtractionJob({
      runId: "run-1",
      userId: "user-1",
      conversationId: "conversation-1",
      recentMessages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
    });

    expect(job).toEqual(expect.objectContaining({
      id: expect.any(String),
      runId: "run-1",
      userId: "user-1",
      conversationId: "conversation-1",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
    }));
  });

  it("job 不存在时明确 no-op", async () => {
    const { db, deleteWhere } = createDb();
    mocks.getDb.mockResolvedValue(db);

    await expect(processMemoryExtractionJob("job-1")).resolves.toBeUndefined();

    expect(mocks.extractMemories).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("成功后只删除匹配 job id", async () => {
    const row = {
      id: "job-1",
      userId: "user-1",
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    };
    const { db, deleteWhere } = createDb(row);
    mocks.getDb.mockResolvedValue(db);

    await processMemoryExtractionJob("job-1");

    expect(mocks.extractMemories).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      row.messages,
    );
    expect(deleteWhere).toHaveBeenCalledWith({ left: "jobs.id", right: "job-1" });
  });

  it("提取失败时保留 durable row 并传播错误", async () => {
    const { db, deleteWhere } = createDb({
      id: "job-1",
      userId: "user-1",
      conversationId: "conversation-1",
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }],
    });
    mocks.getDb.mockResolvedValue(db);
    const error = new Error("retry memory extraction");
    mocks.extractMemories.mockRejectedValueOnce(error);

    await expect(processMemoryExtractionJob("job-1")).rejects.toBe(error);
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
