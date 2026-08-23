import { describe, expect, it } from "vitest";
import { DEFAULT_GATEWAY_GOVERNANCE_POLICY } from "./policy";
import {
  buildGatewayGovernanceReplay,
  type GatewayGovernanceHourlyPoint,
} from "./analytics";

describe("gateway governance history replay", () => {
  it("compares persisted peaks without inventing future rejection counts", () => {
    const point = (scope: "key" | "user", rpmPeak: number, concurrencyPeak: number) => ({
      bucketStart: new Date("2026-08-24T12:00:00Z"),
      scope,
      requestCount: 20,
      rpmPeak,
      concurrencyPeak,
      rateRejected: 0,
      concurrencyRejected: 0,
      quotaChatTokensRejected: 0,
      quotaImageCountRejected: 0,
      quotaTtsCodePointsRejected: 0,
      quotaSttSecondsRejected: 0,
      updatedAt: new Date("2026-08-24T12:00:05Z"),
    }) satisfies GatewayGovernanceHourlyPoint;

    expect(buildGatewayGovernanceReplay([
      point("key", DEFAULT_GATEWAY_GOVERNANCE_POLICY.key.rpm + 1, 1),
      point("user", 1, DEFAULT_GATEWAY_GOVERNANCE_POLICY.user.concurrency + 1),
    ], DEFAULT_GATEWAY_GOVERNANCE_POLICY)).toEqual([
      { scope: "key", hours: 1, rpmExceededHours: 1, concurrencyExceededHours: 0 },
      { scope: "user", hours: 1, rpmExceededHours: 0, concurrencyExceededHours: 1 },
    ]);
  });
});
