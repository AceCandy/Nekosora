import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  dbExecute: vi.fn(),
  getStorage: vi.fn(),
  getEnvInfo: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/infra/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@/lib/infra/env", () => ({ getEnvInfo: mocks.getEnvInfo }));

import { GET } from "@/app/healthz/ready/route";

describe("GET /healthz/ready", () => {
  beforeEach(() => {
    mocks.dbExecute.mockReset().mockResolvedValue(undefined);
    mocks.getDb.mockReset().mockResolvedValue({ execute: mocks.dbExecute });
    mocks.getSchema.mockReset();
    mocks.getStorage.mockReset().mockResolvedValue({ kind: "local" });
    mocks.getEnvInfo.mockReset().mockReturnValue({ hasRedis: false });
  });

  it("DB 正常时返回 ready", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ready",
      checks: {
        db: "ok",
        storage: "local",
        redis: false,
      },
    });
  });

  it("DB 异常时返回 503", async () => {
    mocks.dbExecute.mockRejectedValue(new Error("db unavailable"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unready",
      checks: { db: "error" },
    });
  });
});
