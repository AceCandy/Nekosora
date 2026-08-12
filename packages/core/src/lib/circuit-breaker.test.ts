import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireProviderPermit,
  getProviderAvailability,
  recordFailure,
  resetAllBreakers,
  snapshotBreakers,
} from "@/lib/circuit-breaker";

describe("provider circuit breaker", () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("availability 查询不占用冷却到期后的探针", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");

    now.mockReturnValue(31_000);

    expect(getProviderAvailability("provider-a")).toBe("probe_ready");
    expect(getProviderAvailability("provider-a")).toBe("probe_ready");
  });

  it("冷却到期后只有一个请求能获得探针 permit", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);

    const permit = acquireProviderPermit("provider-a");

    expect(permit).not.toBeNull();
    expect(getProviderAvailability("provider-a")).toBe("probe_busy");
    expect(acquireProviderPermit("provider-a")).toBeNull();
  });

  it("探针成功优先于前序 key 失败并恢复 closed", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);

    const permit = acquireProviderPermit("provider-a")!;
    permit.recordFailure();
    permit.recordSuccess();
    permit.release();

    expect(getProviderAvailability("provider-a")).toBe("closed");
    expect(snapshotBreakers()["provider-a"]).toMatchObject({ failures: 0 });
  });

  it("探针失败后重新 open 并刷新冷却时间", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);

    const permit = acquireProviderPermit("provider-a")!;

    now.mockReturnValue(32_000);
    permit.recordFailure();
    permit.release();

    now.mockReturnValue(61_999);
    expect(getProviderAvailability("provider-a")).toBe("open");
    now.mockReturnValue(62_000);
    expect(getProviderAvailability("provider-a")).toBe("probe_ready");
  });

  it("中性 release 不判健康且允许下个请求立即重新竞争探针", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);

    const permit = acquireProviderPermit("provider-a")!;
    permit.release();

    expect(snapshotBreakers()["provider-a"]).toMatchObject({ status: "open", failures: 5 });
    expect(getProviderAvailability("provider-a")).toBe("probe_ready");
    expect(acquireProviderPermit("provider-a")).not.toBeNull();
  });

  it("迟到或重复的旧 permit 不会结算新的探针", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);

    const oldPermit = acquireProviderPermit("provider-a")!;
    oldPermit.release();
    const currentPermit = acquireProviderPermit("provider-a")!;
    oldPermit.recordSuccess();
    oldPermit.release();

    expect(getProviderAvailability("provider-a")).toBe("probe_busy");
    currentPermit.recordFailure();
    currentPermit.release();
    expect(getProviderAvailability("provider-a")).toBe("open");
  });
});
