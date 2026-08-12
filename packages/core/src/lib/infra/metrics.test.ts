import { beforeEach, describe, expect, it } from "vitest";
import {
  gatewayCircuitBreakerEventsTotal,
  gatewayGovernanceFailuresTotal,
  gatewayGovernanceRejectionsTotal,
  gatewayGovernanceSettlementsTotal,
  observeGatewayCircuitBreakerEvent,
  observeGatewayGovernanceFailure,
  observeGatewayGovernanceRejection,
  observeGatewayGovernanceSettlement,
} from "./metrics";

beforeEach(() => {
  gatewayCircuitBreakerEventsTotal.reset();
  gatewayGovernanceFailuresTotal.reset();
  gatewayGovernanceRejectionsTotal.reset();
  gatewayGovernanceSettlementsTotal.reset();
});

describe("gateway circuit breaker metrics", () => {
  it("只使用固定的 event 低基数标签", async () => {
    observeGatewayCircuitBreakerEvent("no_healthy_route");
    observeGatewayCircuitBreakerEvent("probe_released");

    const metric = await gatewayCircuitBreakerEventsTotal.get();
    expect(metric.name).toBe("nekusora_gateway_circuit_breaker_events_total");
    expect(metric.values).toEqual([
      expect.objectContaining({ labels: { event: "no_healthy_route" }, value: 1 }),
      expect.objectContaining({ labels: { event: "probe_released" }, value: 1 }),
    ]);
  });
});

describe("gateway governance metrics", () => {
  it("uses only the approved low-cardinality rejection labels", async () => {
    observeGatewayGovernanceRejection({
      reason: "quota",
      scope: "user",
      operation: "chat.stream",
    });

    const metric = await gatewayGovernanceRejectionsTotal.get();
    expect(metric.name).toBe("nekusora_gateway_governance_rejections_total");
    expect(metric.values).toEqual([
      expect.objectContaining({
        labels: { reason: "quota", scope: "user", operation: "chat.stream" },
        value: 1,
      }),
    ]);
  });

  it("records quota settlement outcome and fixed failure stage", async () => {
    observeGatewayGovernanceSettlement({ quotaKind: "stt_seconds", outcome: "overage" });
    observeGatewayGovernanceFailure("policy_invalid");

    expect((await gatewayGovernanceSettlementsTotal.get()).values).toEqual([
      expect.objectContaining({
        labels: { quota_kind: "stt_seconds", outcome: "overage" },
        value: 1,
      }),
    ]);
    expect((await gatewayGovernanceFailuresTotal.get()).values).toEqual([
      expect.objectContaining({ labels: { stage: "policy_invalid" }, value: 1 }),
    ]);
  });
});
