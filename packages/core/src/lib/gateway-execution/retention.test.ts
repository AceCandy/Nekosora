import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  observeGatewayRetentionClaim: vi.fn(),
  observeGatewayRetentionRun: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    values,
  })),
}));

vi.mock("drizzle-orm", () => ({ sql: mocks.sql }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/infra/metrics", () => ({
  observeGatewayRetentionClaim: mocks.observeGatewayRetentionClaim,
  observeGatewayRetentionRun: mocks.observeGatewayRetentionRun,
}));

import {
  claimGatewayRetention,
  deleteExpiredGatewayExecutions,
  runGatewayRetention,
} from "./retention";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gateway execution retention", () => {
  it("使用数据库 UTC 日期原子领取且零行表示已领取", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "gateway-executions" }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getDb.mockResolvedValue({ execute });

    await expect(claimGatewayRetention()).resolves.toBe(true);
    await expect(claimGatewayRetention()).resolves.toBe(false);

    const query = execute.mock.calls[0]![0] as { text: string };
    expect(query.text).toContain("AT TIME ZONE 'UTC'");
    expect(query.text).toContain("ON CONFLICT");
    expect(query.text).toContain('"last_claimed_date" < excluded."last_claimed_date"');
  });

  it("只删除已完成终态，按 30/90 天排序且最多 1000 条", async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { status: "success" },
        { status: "success" },
        { status: "failed" },
        { status: "interrupted" },
      ],
    });
    mocks.getDb.mockResolvedValue({ execute });

    await expect(deleteExpiredGatewayExecutions()).resolves.toEqual({
      success: 2,
      failed: 1,
      interrupted: 1,
    });

    const query = execute.mock.calls[0]![0] as { text: string; values: unknown[] };
    expect(query.text).toContain('"completed_at" IS NOT NULL');
    expect(query.text).toContain("interval '30 days'");
    expect(query.text).toContain("interval '90 days'");
    expect(query.text).toContain("'failed', 'interrupted'");
    expect(query.text).not.toContain("'running'");
    expect(query.text).toContain('ORDER BY "created_at" ASC, "id" ASC');
    expect(query.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(query.values).toEqual([1_000]);
  });

  it("跳过已领取日期，成功只运行一个删除批次", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    mocks.getDb.mockResolvedValue({ execute });

    await runGatewayRetention();

    expect(execute).toHaveBeenCalledOnce();
    expect(mocks.observeGatewayRetentionClaim).toHaveBeenCalledWith("skipped");
    expect(mocks.observeGatewayRetentionRun).not.toHaveBeenCalled();
  });

  it("领取或删除失败只记录固定结果并继续抛出", async () => {
    const claimError = new Error("postgresql://secret");
    mocks.getDb.mockResolvedValueOnce({ execute: vi.fn().mockRejectedValue(claimError) });
    await expect(runGatewayRetention()).rejects.toBe(claimError);
    expect(mocks.observeGatewayRetentionClaim).toHaveBeenCalledWith("failed");

    mocks.observeGatewayRetentionClaim.mockClear();
    const deleteError = new Error("request-id-secret");
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "gateway-executions" }] })
      .mockRejectedValueOnce(deleteError);
    mocks.getDb.mockResolvedValue({ execute });
    await expect(runGatewayRetention()).rejects.toBe(deleteError);
    expect(mocks.observeGatewayRetentionClaim).toHaveBeenCalledWith("claimed");
    expect(mocks.observeGatewayRetentionRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      deleted: {},
    }));
  });
});
