import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  getQueue: vi.fn(),
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
  getQueue: mocks.getQueue,
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
} from "./dispatch";
import { CONVERSATION_TITLE_QUEUE } from "@/lib/jobs/catalog";

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
  mocks.getQueue.mockReset().mockResolvedValue({ send: mocks.send });
  mocks.send.mockReset().mockResolvedValue("queue-job-1");
});

describe("conversation title dispatch", () => {
  it("队列驱动未配置时不 claim durable job", async () => {
    mocks.jobs = [job("job-1")];
    mocks.getQueue.mockRejectedValue(new Error("queue unavailable"));

    await expect(dispatchConversationTitleJob("job-1")).rejects.toThrow("queue unavailable");

    expect(mocks.jobs[0]!.dispatchAfter).toBe(-1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("并发 dispatcher 对同一到期 job 只有一个 claim 并发送", async () => {
    mocks.jobs = [job("job-1")];

    const results = await Promise.all([
      dispatchConversationTitleJob("job-1"),
      dispatchConversationTitleJob("job-1"),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(
      CONVERSATION_TITLE_QUEUE,
      { id: "job-1" },
    );
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await recoverConversationTitleJobs();

    expect(mocks.send).toHaveBeenCalledTimes(25);
    expect(mocks.jobs.filter((item) => Number(item.dispatchAfter) <= 0)).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[conversation-title-recovery] dispatch failed",
    );
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("job-0");
    expect(logged).not.toContain("first send failed");
  });
});
