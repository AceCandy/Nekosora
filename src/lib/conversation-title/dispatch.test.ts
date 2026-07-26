import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  send: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  asc: (col: string) => ({ col }),
  eq: (col: string, val: unknown) => ({ type: "eq", col, val }),
  lte: (col: string, val: unknown) => ({ type: "lte", col, val }),
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));

vi.mock("@/lib/infra/queue", () => ({
  getQueue: vi.fn(async () => ({ send: mocks.send })),
}));

vi.mock("@/lib/redaction", () => ({
  redactErrorMessage: vi.fn((_error: unknown, _secrets: unknown[], fallback: string) => fallback),
}));

vi.mock("@/lib/infra/db", () => {
  function matches(row: Record<string, unknown>, cond: unknown): boolean {
    const value = cond as { type?: string; col?: string; val?: unknown; conds?: unknown[] };
    if (value.type === "and") return value.conds!.every((item) => matches(row, item));
    if (value.type === "eq") return row[value.col!] === value.val;
    if (value.type === "lte") return Number(row[value.col!]) <= 0;
    return true;
  }

  function project(rows: Record<string, unknown>[], fields: Record<string, string>) {
    return rows.map((row) => Object.fromEntries(
      Object.entries(fields).map(([key, col]) => [key, row[col]]),
    ));
  }

  const schema = {
    conversationTitleJobs: {
      __table: "conversationTitleJobs",
      id: "id",
      conversationId: "conversationId",
      userId: "userId",
      firstUserMessage: "firstUserMessage",
      fallbackTitle: "fallbackTitle",
      chatModel: "chatModel",
      chatModelId: "chatModelId",
      dispatchAfter: "dispatchAfter",
      createdAt: "createdAt",
    },
  };

  return {
    getSchema: () => schema,
    getDb: async () => ({
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => ({
            returning: async (fields: Record<string, string>) => {
              const matched = mocks.jobs.filter((job) => matches(job, cond));
              for (const job of matched) Object.assign(job, patch);
              return project(matched, fields);
            },
          }),
        }),
      }),
      select: (fields: Record<string, string>) => ({
        from: () => ({
          where: (cond: unknown) => ({
            orderBy: () => ({
              limit: async (limit: number) => project(
                mocks.jobs
                  .filter((job) => matches(job, cond))
                  .sort((a, b) => Number(a.dispatchAfter) - Number(b.dispatchAfter)
                    || Number(a.createdAt) - Number(b.createdAt))
                  .slice(0, limit),
                fields,
              ),
            }),
          }),
        }),
      }),
    }),
  };
});

import {
  dispatchConversationTitleJob,
  recoverConversationTitleJobs,
  startConversationTitleRecovery,
} from "./dispatch";

function job(id: string, dispatchAfter = -1, createdAt = 0) {
  return {
    id,
    conversationId: `conversation-${id}`,
    userId: "user-1",
    firstUserMessage: `message-${id}`,
    fallbackTitle: `fallback-${id}`,
    chatModel: null,
    chatModelId: null,
    dispatchAfter,
    createdAt,
  };
}

beforeEach(() => {
  mocks.jobs = [];
  mocks.send.mockReset().mockResolvedValue("queue-job-1");
});

describe("conversation title dispatch", () => {
  it("并发 dispatcher 对同一到期 job 只有一个 claim 并发送", async () => {
    mocks.jobs = [job("job-1")];

    const results = await Promise.all([
      dispatchConversationTitleJob("job-1"),
      dispatchConversationTitleJob("job-1"),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith("conversation-title", expect.objectContaining({
      id: "job-1",
      conversationId: "conversation-job-1",
    }));
  });

  it("未到期 job no-op，send 失败仍保留 outbox 且窗口后可重投", async () => {
    mocks.jobs = [job("job-1", 1)];
    await expect(dispatchConversationTitleJob("job-1")).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.jobs[0].dispatchAfter = -1;
    mocks.send.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(dispatchConversationTitleJob("job-1")).rejects.toThrow("queue unavailable");
    expect(mocks.jobs).toHaveLength(1);

    mocks.jobs[0].dispatchAfter = -1;
    await expect(dispatchConversationTitleJob("job-1")).resolves.toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("按稳定顺序扫描最多 25 条，单项失败不阻断后续", async () => {
    mocks.jobs = Array.from({ length: 26 }, (_, index) => job(
      `job-${index}`,
      index % 2 === 0 ? -2 : -1,
      26 - index,
    ));
    mocks.send.mockRejectedValueOnce(new Error("first send failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await recoverConversationTitleJobs();

    expect(mocks.send).toHaveBeenCalledTimes(25);
    expect(mocks.jobs.filter((item) => Number(item.dispatchAfter) <= 0)).toHaveLength(1);
  });

  it("启动立即扫描、周期单飞，停止等待在途扫描并禁止后续 tick", async () => {
    vi.useFakeTimers();
    let resolveScan!: () => void;
    const scan = vi.fn(() => new Promise<void>((resolve) => {
      resolveScan = resolve;
    }));
    const stop = startConversationTitleRecovery(scan);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(scan).toHaveBeenCalledOnce();

    const stopped = stop();
    let didStop = false;
    void stopped.then(() => { didStop = true; });
    await Promise.resolve();
    expect(didStop).toBe(false);
    resolveScan();
    await stopped;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
