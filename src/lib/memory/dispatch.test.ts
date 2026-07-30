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
  const schema = {
    memoryExtractionJobs: {
      id: "id",
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
            returning: async () => {
              const [matched] = mocks.jobs.filter((job) => matches(job, cond));
              if (!matched) return [];
              Object.assign(matched, patch);
              return [{ id: matched.id }];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: (cond: unknown) => ({
            orderBy: () => ({
              limit: async (limit: number) => mocks.jobs
                .filter((job) => matches(job, cond))
                .sort((a, b) => Number(a.dispatchAfter) - Number(b.dispatchAfter)
                  || Number(a.createdAt) - Number(b.createdAt))
                .slice(0, limit)
                .map((job) => ({ id: job.id })),
            }),
          }),
        }),
      }),
    }),
  };
});

import {
  dispatchMemoryExtractionJob,
  recoverMemoryExtractionJobs,
  startMemoryExtractionRecovery,
} from "./dispatch";

function job(id: string, dispatchAfter = -1, createdAt = 0) {
  return { id, dispatchAfter, createdAt };
}

beforeEach(() => {
  mocks.jobs = [];
  mocks.send.mockReset().mockResolvedValue("queue-job-1");
});

describe("memory extraction dispatch", () => {
  it("并发 dispatcher 对同一 intent 只有一个 claim", async () => {
    mocks.jobs = [job("job-1")];

    const results = await Promise.all([
      dispatchMemoryExtractionJob("job-1"),
      dispatchMemoryExtractionJob("job-1"),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith("memory-extract", { id: "job-1" });
  });

  it("send 失败保留 intent 并可在 claim 窗口后重投", async () => {
    mocks.jobs = [job("job-1")];
    mocks.send.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(dispatchMemoryExtractionJob("job-1")).rejects.toThrow("queue unavailable");
    expect(mocks.jobs).toHaveLength(1);

    mocks.jobs[0]!.dispatchAfter = -1;
    await expect(dispatchMemoryExtractionJob("job-1")).resolves.toBe(true);
  });

  it("恢复扫描最多 25 条并隔离单项失败", async () => {
    mocks.jobs = Array.from({ length: 26 }, (_, index) => job(`job-${index}`, -1, index));
    mocks.send.mockRejectedValueOnce(new Error("first send failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await recoverMemoryExtractionJobs();

    expect(mocks.send).toHaveBeenCalledTimes(25);
  });

  it("scheduler 单飞且 stop 等待在途扫描", async () => {
    vi.useFakeTimers();
    let resolveScan!: () => void;
    const scan = vi.fn(() => new Promise<void>((resolve) => { resolveScan = resolve; }));
    const stop = startMemoryExtractionRecovery(scan);
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(scan).toHaveBeenCalledOnce();
    const stopped = stop();
    resolveScan();
    await stopped;
    vi.useRealTimers();
  });
});
