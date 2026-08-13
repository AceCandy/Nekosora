import { beforeEach, describe, expect, it } from "vitest";
import {
  gatewayAttemptsTotal,
  gatewayCircuitBreakerEventsTotal,
  gatewayExecutionsTotal,
  gatewayGovernanceFailuresTotal,
  gatewayGovernanceRejectionsTotal,
  gatewayGovernanceSettlementsTotal,
  observeGatewayAttempt,
  observeGatewayCircuitBreakerEvent,
  observeGatewayGovernanceFailure,
  observeGatewayGovernanceRejection,
  observeGatewayGovernanceSettlement,
  observeGatewayExecution,
  observeRequest,
  requestTotal,
  tokensTotal,
} from "./metrics";

beforeEach(() => {
  gatewayAttemptsTotal.reset();
  gatewayCircuitBreakerEventsTotal.reset();
  gatewayExecutionsTotal.reset();
  gatewayGovernanceFailuresTotal.reset();
  gatewayGovernanceRejectionsTotal.reset();
  gatewayGovernanceSettlementsTotal.reset();
  requestTotal.reset();
  tokensTotal.reset();
});

describe("metric label boundaries", () => {
  it("把任意请求标签收敛到固定集合或 unknown", async () => {
    observeRequest({
      source: "x".repeat(2_000),
      modelType: "attacker-model",
      status: "custom-status",
      latencyMs: 1,
      promptTokens: 2,
      completionTokens: 3,
    });

    expect((await requestTotal.get()).values).toEqual([
      expect.objectContaining({
        labels: { source: "unknown", model_type: "unknown", status: "unknown" },
        value: 1,
      }),
    ]);
    expect((await tokensTotal.get()).values).toEqual([
      expect.objectContaining({ labels: { type: "prompt", model_type: "unknown" }, value: 2 }),
      expect.objectContaining({ labels: { type: "completion", model_type: "unknown" }, value: 3 }),
    ]);
  });

  it("保留已批准值并收敛 execution/attempt 未知值", async () => {
    observeGatewayExecution({
      operation: "chat.stream",
      source: "gateway",
      status: "success",
      modelType: "chat",
      latencyMs: 1,
      promptTokens: 0,
      completionTokens: 0,
    });
    observeGatewayAttempt({
      operation: "unbounded-operation",
      status: "unbounded-status",
      protocol: "unbounded-protocol",
    });

    expect((await gatewayExecutionsTotal.get()).values[0]?.labels).toEqual({
      operation: "chat.stream",
      source: "gateway",
      status: "success",
      model_type: "chat",
    });
    expect((await gatewayAttemptsTotal.get()).values[0]?.labels).toEqual({
      operation: "unknown",
      status: "unknown",
      protocol: "unknown",
    });
  });
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

  it("把未知治理标签统一归入 unknown", async () => {
    observeGatewayGovernanceRejection({
      reason: "unbounded-reason",
      scope: "unbounded-scope",
      operation: "unbounded-operation",
    });
    observeGatewayGovernanceSettlement({ quotaKind: "unbounded-kind", outcome: "settled" });
    observeGatewayGovernanceFailure("unbounded-stage");

    expect((await gatewayGovernanceRejectionsTotal.get()).values[0]?.labels).toEqual({
      reason: "unknown",
      scope: "unknown",
      operation: "unknown",
    });
    expect((await gatewayGovernanceSettlementsTotal.get()).values[0]?.labels).toEqual({
      quota_kind: "unknown",
      outcome: "settled",
    });
    expect((await gatewayGovernanceFailuresTotal.get()).values[0]?.labels).toEqual({
      stage: "unknown",
    });
  });
});
