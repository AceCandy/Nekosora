import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordGatewayGovernanceAggregateRejection,
  recordGatewayGovernanceConcurrency,
  recordGatewayGovernanceRequest,
  startGatewayGovernanceAggregate,
} from "./aggregate";
import {
  GatewayGovernanceRepository,
  GovernanceRejectedError,
  type GatewayGovernanceHourlyDelta,
} from "./repository";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-24T12:34:56.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("gateway governance hourly aggregate", () => {
  it("aggregates fleet counts, subject peaks and rejection reasons without identifiers", async () => {
    const upsertHourly = vi.fn().mockResolvedValue(undefined);
    const controller = startGatewayGovernanceAggregate({
      repository: { upsertHourly } as unknown as GatewayGovernanceRepository,
    });

    recordGatewayGovernanceRequest({ keyRpm: 3, userRpm: 5 });
    recordGatewayGovernanceRequest({ keyRpm: 7, userRpm: 4 });
    recordGatewayGovernanceConcurrency({ keyConcurrency: 2, userConcurrency: 8 });
    recordGatewayGovernanceConcurrency({ keyConcurrency: 6, userConcurrency: 3 });
    recordGatewayGovernanceAggregateRejection(new GovernanceRejectedError({
      reason: "rate",
      scope: "key",
      retryAfterSeconds: 1,
    }));
    recordGatewayGovernanceAggregateRejection(new GovernanceRejectedError({
      reason: "quota",
      scope: "user",
      quotaKind: "image_count",
      retryAfterSeconds: 1,
    }));

    await controller.stop();

    const rows = upsertHourly.mock.calls[0]![0] as GatewayGovernanceHourlyDelta[];
    expect(rows).toEqual([
      expect.objectContaining({
        bucketStart: new Date("2026-08-24T12:00:00.000Z"),
        scope: "key",
        requestCount: 2,
        rpmPeak: 7,
        concurrencyPeak: 6,
        rateRejected: 1,
      }),
      expect.objectContaining({
        bucketStart: new Date("2026-08-24T12:00:00.000Z"),
        scope: "user",
        requestCount: 2,
        rpmPeak: 5,
        concurrencyPeak: 8,
        quotaImageCountRejected: 1,
      }),
    ]);
    expect(Object.keys(rows[0]!)).toEqual([
      "bucketStart",
      "scope",
      "requestCount",
      "rpmPeak",
      "concurrencyPeak",
      "rateRejected",
      "concurrencyRejected",
      "quotaChatTokensRejected",
      "quotaImageCountRejected",
      "quotaTtsCodePointsRejected",
      "quotaSttSecondsRejected",
    ]);
  });

  it("merges a failed swapped batch into new traffic and retries once on stop", async () => {
    const upsertHourly = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);
    const onFailure = vi.fn();
    const controller = startGatewayGovernanceAggregate({
      repository: { upsertHourly } as unknown as GatewayGovernanceRepository,
      intervalMs: 10,
      onFailure,
    });

    recordGatewayGovernanceRequest({ keyRpm: 2, userRpm: 2 });
    await vi.advanceTimersByTimeAsync(10);
    recordGatewayGovernanceRequest({ keyRpm: 4, userRpm: 4 });
    await controller.stop();

    expect(onFailure).toHaveBeenCalledOnce();
    expect(upsertHourly).toHaveBeenCalledTimes(2);
    const retried = upsertHourly.mock.calls[1]![0] as GatewayGovernanceHourlyDelta[];
    expect(retried).toEqual([
      expect.objectContaining({ scope: "key", requestCount: 2, rpmPeak: 4 }),
      expect.objectContaining({ scope: "user", requestCount: 2, rpmPeak: 4 }),
    ]);
  });
});
