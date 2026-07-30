import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEST_EFFORT_TIMEOUT_MS } from "@/lib/best-effort";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: "sql",
    text: strings.join("?"),
    values,
  })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq, and: mocks.and, sql: mocks.sql }));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));

import {
  createRunId,
  finalizeRun,
  heartbeatRun,
  irUsageToTokenUsage,
  recordToolCallResult,
  recordToolCallStart,
  startRunStrict,
  toSafeJsonb,
} from "./run-lifecycle";

const schema = {
  runs: {
    runId: "runs.runId",
    status: "runs.status",
    leaseExpiresAt: "runs.leaseExpiresAt",
  },
  toolCalls: {
    runId: "toolCalls.runId",
    toolCallId: "toolCalls.toolCallId",
  },
};

function createDb() {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
  };
  return { db, insertValues, updateSet, updateWhere };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("toSafeJsonb / irUsageToTokenUsage", () => {
  it("脱敏敏感键并截断过长字符串", () => {
    const long = "x".repeat(5_000);
    const out = toSafeJsonb({
      authorization: "Bearer secret-token",
      key: "generic-secret",
      apiKey: "sk-abc",
      nested: { password: "p@ss", ok: 1 },
      diagnostic: "fetch failed: https://example.test/models?key=QUERY_SECRET",
      error: new Error("Authorization: Bearer HEADER_SECRET"),
      body: long,
    }) as Record<string, unknown>;

    expect(out.authorization).toBe("[REDACTED]");
    expect(out.key).toBe("[REDACTED]");
    expect(out.apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(out.diagnostic).toBe(
      "fetch failed: https://example.test/models?key=[REDACTED]",
    );
    expect(out.error).toEqual({
      name: "Error",
      message: "Authorization: Bearer [REDACTED]",
    });
    expect(String(out.body)).toContain("[truncated");
  });

  it("处理循环引用与 BigInt,不抛错", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const out = toSafeJsonb({ circular, n: 10n }) as Record<string, unknown>;
    expect(out.n).toBe("10");
    expect((out.circular as Record<string, unknown>).self).toBe("[Circular]");
  });

  it("IRUsage 映射到 TokenUsage", () => {
    expect(
      irUsageToTokenUsage({
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 2,
        reasoningTokens: 1,
      }),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      cacheReadTokens: 2,
      reasoningTokens: 1,
    });
    expect(irUsageToTokenUsage(undefined)).toBeNull();
  });
});

describe("run lifecycle DB writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchema.mockReturnValue(schema);
  });

  it("startRunStrict 只在 run 插入确认后返回", async () => {
    const { db, insertValues } = createDb();
    const pending = deferred<void>();
    insertValues.mockReturnValueOnce(pending.promise);
    mocks.getDb.mockResolvedValue(db);

    let settled = false;
    const starting = startRunStrict({
      runId: "run_strict",
      conversationId: "conversation-1",
      userId: "user-1",
      platformModelName: "model-a",
    }).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pending.resolve();
    await expect(starting).resolves.toBeUndefined();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run_strict",
      status: "running",
    }));
  });

  it("startRunStrict 失败时抛通用错误且不泄露底层信息", async () => {
    const { db, insertValues } = createDb();
    insertValues.mockRejectedValueOnce(
      new Error("postgres password=secret connection failed"),
    );
    mocks.getDb.mockResolvedValue(db);

    await expect(startRunStrict({
      runId: "run_strict_failed",
      conversationId: "conversation-1",
      userId: "user-1",
    })).rejects.toMatchObject({
      name: "RunStartError",
      message: "生成任务启动失败",
    });
  });

  it("finalizeRun 仅更新 running 行并写入完整终态元数据", async () => {
    const { db, updateSet, updateWhere } = createDb();
    mocks.getDb.mockResolvedValue(db);
    const completedAt = new Date("2026-07-27T08:09:10.000Z");

    await finalizeRun({
      runId: "run_1",
      status: "success",
      tokenUsage: { promptTokens: 1, completionTokens: 2 },
      durationMs: 1_234,
      completedAt,
    });

    expect(db.update).toHaveBeenCalledWith(schema.runs);
    expect(updateSet).toHaveBeenCalledWith({
      status: "success",
      tokenUsage: { promptTokens: 1, completionTokens: 2 },
      firstTokenLatencyMs: null,
      durationMs: 1_234,
      completedAt,
    });
    expect(updateWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.runs.runId, right: "run_1" },
        { op: "eq", left: schema.runs.status, right: "running" },
      ],
    });
  });

  it("heartbeatRun 只为当前 running run 续租", async () => {
    const { db, updateSet, updateWhere } = createDb();
    mocks.getDb.mockResolvedValue(db);

    await heartbeatRun("run_1");

    expect(db.update).toHaveBeenCalledWith(schema.runs);
    expect(updateSet).toHaveBeenCalledWith({
      leaseExpiresAt: expect.objectContaining({
        op: "sql",
        text: expect.stringContaining("now()"),
      }),
    });
    expect(updateWhere).toHaveBeenCalledWith({
      op: "and",
      conditions: [
        { op: "eq", left: schema.runs.runId, right: "run_1" },
        { op: "eq", left: schema.runs.status, right: "running" },
      ],
    });
  });

  it("tool-call 成功写 running;tool-result 成功/失败更新", async () => {
    const { db, insertValues, updateSet } = createDb();
    mocks.getDb.mockResolvedValue(db);

    await recordToolCallStart({
      runId: "run_1",
      toolCallId: "tc1",
      toolName: "demo__echo",
      args: { q: "hi", apiKey: "sk-secret" },
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run_1",
        toolCallId: "tc1",
        toolName: "demo__echo",
        toolType: "server",
        status: "running",
        inputJson: expect.objectContaining({
          q: "hi",
          apiKey: "[REDACTED]",
        }),
      }),
    );

    await recordToolCallResult({
      runId: "run_1",
      toolCallId: "tc1",
      result: { ok: true },
      isError: false,
    });
    expect(updateSet).toHaveBeenLastCalledWith({
      status: "success",
      outputJson: { ok: true },
      errorJson: null,
    });

    await recordToolCallResult({
      runId: "run_1",
      toolCallId: "tc1",
      result: "boom",
      isError: true,
    });
    expect(updateSet).toHaveBeenLastCalledWith({
      status: "failed",
      errorJson: "boom",
      outputJson: null,
    });
  });

  it("DB 失败时 strict start 拒绝，其他审计写入不抛", async () => {
    mocks.getDb.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      startRunStrict({ runId: "run_x", conversationId: "c", userId: "u" }),
    ).rejects.toMatchObject({ name: "RunStartError", message: "生成任务启动失败" });
    await expect(
      finalizeRun({ runId: "run_x", status: "failed" }),
    ).resolves.toBeUndefined();
    await expect(heartbeatRun("run_x")).resolves.toBeUndefined();
    await expect(
      recordToolCallStart({
        runId: "run_x",
        toolCallId: "tc",
        toolName: "t",
      }),
    ).resolves.toBeUndefined();
    await expect(
      recordToolCallResult({ runId: "run_x", toolCallId: "tc", isError: true }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    // 日志不含密钥明文
    for (const call of errSpy.mock.calls) {
      const text = call.map(String).join(" ");
      expect(text).not.toMatch(/sk-|Bearer /i);
    }
    errSpy.mockRestore();
  });

  it("挂起的 strict start/finalize/tool 写入在等待预算后释放调用方", async () => {
    vi.useFakeTimers();
    mocks.getDb.mockReturnValue(new Promise(() => {}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let startError: unknown;
    let completedVoidWrites = 0;

    void startRunStrict({
      runId: "run_timeout",
      conversationId: "conversation_timeout",
      userId: "sk-sensitive-user",
    }).catch((error) => {
      startError = error;
    });
    void finalizeRun({ runId: "run_timeout", status: "failed" }).then(() => {
      completedVoidWrites += 1;
    });
    void recordToolCallStart({
      runId: "run_timeout",
      toolCallId: "tool_timeout",
      toolName: "secret-tool",
      args: { apiKey: "sk-sensitive-argument" },
    }).then(() => {
      completedVoidWrites += 1;
    });
    void recordToolCallResult({
      runId: "run_timeout",
      toolCallId: "tool_timeout",
      result: { authorization: "Bearer sensitive-result" },
      isError: true,
    }).then(() => {
      completedVoidWrites += 1;
    });

    await vi.advanceTimersByTimeAsync(BEST_EFFORT_TIMEOUT_MS);

    expect(startError).toMatchObject({
      name: "RunStartError",
      message: "生成任务启动失败",
    });
    expect(completedVoidWrites).toBe(3);
    expect(errSpy).toHaveBeenCalledTimes(4);
    for (const call of errSpy.mock.calls) {
      expect(call.map(String).join(" ")).not.toMatch(
        /sk-sensitive|Bearer sensitive|secret-tool/i,
      );
    }
    errSpy.mockRestore();
  });

  it("createRunId 前缀 run_", () => {
    expect(createRunId()).toMatch(/^run_/);
  });
});
