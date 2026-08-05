import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isProviderAllowed,
  recordFailure,
  recordSuccess,
  resetAllBreakers,
} from "@/lib/circuit-breaker";

describe("provider circuit breaker", () => {
  beforeEach(() => {
    resetAllBreakers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("冷却到期后只放行一个 half-open 探测请求", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");

    now.mockReturnValue(31_000);

    expect(isProviderAllowed("provider-a")).toBe(true);
    expect(isProviderAllowed("provider-a")).toBe(false);
  });

  it("half-open 探测成功后恢复 closed 并持续放行", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);

    expect(isProviderAllowed("provider-a")).toBe(true);
    recordSuccess("provider-a");

    expect(isProviderAllowed("provider-a")).toBe(true);
    expect(isProviderAllowed("provider-a")).toBe(true);
  });

  it("half-open 探测失败后重新 open 并刷新冷却时间", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let i = 0; i < 5; i++) recordFailure("provider-a");
    now.mockReturnValue(31_000);
    expect(isProviderAllowed("provider-a")).toBe(true);

    now.mockReturnValue(32_000);
    recordFailure("provider-a");

    now.mockReturnValue(61_999);
    expect(isProviderAllowed("provider-a")).toBe(false);
    now.mockReturnValue(62_000);
    expect(isProviderAllowed("provider-a")).toBe(true);
  });
});
