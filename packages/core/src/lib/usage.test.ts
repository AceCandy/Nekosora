import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEST_EFFORT_TIMEOUT_MS } from "@/lib/best-effort";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  observeRequest: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/infra/metrics", () => ({
  observeRequest: mocks.observeRequest,
}));

import { logUsage, maskKey } from "@/lib/usage";

afterEach(() => {
  vi.useRealTimers();
});

describe("maskKey", () => {
  it("空值返回 null;空字符串(无 key provider)返回「无key」", () => {
    expect(maskKey(undefined)).toBeNull();
    expect(maskKey(null)).toBeNull();
    expect(maskKey("")).toBe("无key");
  });

  it("长 key 取前3后3,中间用 * 连接", () => {
    expect(maskKey("sk-abcdefxyz123")).toBe("sk-***123");
  });

  it("恰好 7 位也走长 key 分支(前3后3)", () => {
    expect(maskKey("abcdefg")).toBe("abc***efg");
  });

  it("短 key(length <= 6)兜底:前2 + ***,不暴露全量", () => {
    expect(maskKey("abcdef")).toBe("ab***");
    expect(maskKey("abc")).toBe("ab***");
    expect(maskKey("ab")).toBe("ab***");
  });

  it("典型 OpenAI 风格 key 脱敏正确", () => {
    expect(maskKey("sk-proj-TzX4m9Q8s2Kp7vR3")).toBe("sk-***vR3");
  });
});

describe("logUsage", () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const schema = { gatewayExecutions: "gatewayExecutions" };

  beforeEach(() => {
    vi.clearAllMocks();
    values.mockResolvedValue(undefined);
    mocks.getSchema.mockReturnValue(schema);
    mocks.getDb.mockResolvedValue({ insert });
  });

  it("按 status 分流并保持 metrics/skipMetrics 语义", async () => {
    await logUsage({
      ctx: { userId: "u1", keyKind: null, source: "chat" },
      runId: "run_success",
      model: "demo",
      usage: { inputTokens: 3, outputTokens: 5 },
      latencyMs: 20,
      status: "success",
    });

    expect(insert).toHaveBeenCalledWith(schema.gatewayExecutions);
    expect(mocks.observeRequest).toHaveBeenCalledWith({
      source: "chat",
      model: "demo",
      status: "success",
      latencyMs: 20,
      promptTokens: 3,
      completionTokens: 5,
    });

    insert.mockClear();
    mocks.observeRequest.mockClear();
    await logUsage({
      ctx: { userId: "u1", keyKind: null, source: "chat" },
      runId: "run_interrupted",
      model: "demo",
      usage: {},
      status: "interrupted",
      skipMetrics: true,
    });

    expect(insert).toHaveBeenCalledWith(schema.gatewayExecutions);
    expect(mocks.observeRequest).not.toHaveBeenCalled();
  });

  it("DB 立即失败时记录脱敏错误并 resolve void", async () => {
    mocks.getDb.mockRejectedValue(new Error("db unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logUsage({
        ctx: { userId: "u1", keyKind: null, source: "chat" },
        runId: "run_failed",
        model: "demo",
        usage: {},
        status: "failed",
        skipMetrics: true,
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith("[logUsage] 记录失败:", "db unavailable");
    errSpy.mockRestore();
  });

  it("写入错误日志前兜底清理敏感 query 与 header", async () => {
    await logUsage({
      ctx: { userId: "u1", keyKind: null, source: "chat" },
      runId: "run_1",
      model: "demo",
      usage: {},
      status: "failed",
      errorCode: "upstream_error",
      errorMessage:
        "fetch failed: https://example.test/models?key=QUERY_SECRET Authorization: Bearer HEADER_SECRET",
      skipMetrics: true,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage:
          "fetch failed: https://example.test/models?key=[REDACTED] Authorization: Bearer [REDACTED]",
      }),
    );
  });

  it("getDb 永久挂起时在等待预算后释放并记录脱敏错误", async () => {
    vi.useFakeTimers();
    mocks.getDb.mockReturnValue(new Promise(() => {}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let settled = false;

    void logUsage({
      ctx: { userId: "sk-sensitive-user", keyKind: null, source: "chat" },
      runId: "run_timeout",
      model: "secret-model",
      usage: {},
      status: "failed",
      errorMessage: "Authorization: Bearer sensitive-token",
      skipMetrics: true,
    }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(BEST_EFFORT_TIMEOUT_MS);

    expect(settled).toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls.flat().map(String).join(" ")).not.toMatch(
      /sk-sensitive|secret-model|Bearer sensitive/i,
    );
    errSpy.mockRestore();
  });

  it("insert 永久挂起时在等待预算后释放", async () => {
    vi.useFakeTimers();
    values.mockReturnValue(new Promise(() => {}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let settled = false;

    void logUsage({
      ctx: { userId: "u1", keyKind: null, source: "chat" },
      runId: "run_timeout",
      model: "demo",
      usage: {},
      status: "success",
      skipMetrics: true,
    }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(BEST_EFFORT_TIMEOUT_MS);

    expect(settled).toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
