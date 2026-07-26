import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));

import { logUsage, maskKey } from "@/lib/usage";

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
  const schema = { opsErrorLogs: "opsErrorLogs", usageLogs: "usageLogs" };

  beforeEach(() => {
    vi.clearAllMocks();
    values.mockResolvedValue(undefined);
    mocks.getSchema.mockReturnValue(schema);
    mocks.getDb.mockResolvedValue({ insert: vi.fn(() => ({ values })) });
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
});
