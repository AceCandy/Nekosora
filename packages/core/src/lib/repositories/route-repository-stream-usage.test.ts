import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  set: vi.fn(),
  where: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  asc: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: vi.fn(async () => ({
    update: vi.fn(() => ({ set: mocks.set })),
  })),
  getSchema: vi.fn(() => ({
    providers: {
      id: "providers.id",
      baseUrl: "providers.baseUrl",
      supportsStreamUsage: "providers.supportsStreamUsage",
    },
  })),
}));

import { markProviderStreamUsageUnsupported } from "./route-repository";

describe("markProviderStreamUsageUnsupported", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.set.mockReturnValue({ where: mocks.where });
  });

  it("只更新 ID 与当前 Base URL 同时匹配的 Provider", async () => {
    await markProviderStreamUsageUnsupported("provider-a", "https://api.example.com/v1");

    expect(mocks.set).toHaveBeenCalledWith({ supportsStreamUsage: false });
    expect(mocks.eq).toHaveBeenCalledWith("providers.id", "provider-a");
    expect(mocks.eq).toHaveBeenCalledWith(
      "providers.baseUrl",
      "https://api.example.com/v1",
    );
    expect(mocks.and).toHaveBeenCalledWith(
      { column: "providers.id", value: "provider-a" },
      { column: "providers.baseUrl", value: "https://api.example.com/v1" },
    );
    expect(mocks.where).toHaveBeenCalledOnce();
  });
});
