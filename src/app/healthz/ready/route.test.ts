import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  dbExecute: vi.fn(),
  getStorage: vi.fn(),
  queueAvailable: vi.fn(),
  getEnvInfo: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@/lib/infra/queue", () => ({ queueAvailable: mocks.queueAvailable }));
vi.mock("@/lib/infra/env", () => ({ getEnvInfo: mocks.getEnvInfo }));

import { GET } from "@/app/healthz/ready/route";

describe("GET /healthz/ready", () => {
  beforeEach(() => {
    mocks.dbExecute.mockReset().mockResolvedValue(undefined);
    mocks.getDb.mockReset().mockResolvedValue({ execute: mocks.dbExecute });
    mocks.getSchema.mockReset();
    mocks.getStorage.mockReset().mockResolvedValue({ kind: "local" });
    mocks.queueAvailable.mockReset().mockResolvedValue(true);
    mocks.getEnvInfo.mockReset().mockReturnValue({ hasRedis: false });
  });

  it("DB 与 queue 正常时返回 ready", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ready",
      checks: {
        db: "ok",
        storage: "local",
        queue: { available: true },
        redis: false,
      },
    });
  });

  it("queue 显式不可用时返回 503", async () => {
    mocks.queueAvailable.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unready",
      checks: { db: "ok", queue: { available: false } },
    });
  });

  it("queue 初始化异常时返回 503 并保留 error 诊断", async () => {
    mocks.queueAvailable.mockRejectedValue(new Error("queue unavailable"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unready",
      checks: { db: "ok", queue: "error" },
    });
  });

  it("queue 检查超时时返回 503", async () => {
    vi.useFakeTimers();
    mocks.queueAvailable.mockReturnValue(new Promise(() => {}));

    try {
      const responsePromise = GET();
      await vi.advanceTimersByTimeAsync(2000);
      const response = await responsePromise;

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: "unready",
        checks: { db: "ok", queue: "timeout" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("DB 异常时即使 queue 正常也返回 503", async () => {
    mocks.dbExecute.mockRejectedValue(new Error("db unavailable"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unready",
      checks: { db: "error", queue: { available: true } },
    });
  });
});
