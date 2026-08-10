import { beforeEach, describe, expect, it } from "vitest";
import {
  gatewayGovernanceFailuresTotal,
  gatewayGovernanceRejectionsTotal,
  gatewayGovernanceSettlementsTotal,
  observeGatewayGovernanceFailure,
  observeGatewayGovernanceRejection,
  observeGatewayGovernanceSettlement,
} from "./metrics";

beforeEach(() => {
  gatewayGovernanceFailuresTotal.reset();
  gatewayGovernanceRejectionsTotal.reset();
  gatewayGovernanceSettlementsTotal.reset();
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
