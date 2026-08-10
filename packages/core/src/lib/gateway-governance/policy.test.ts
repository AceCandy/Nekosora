import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATEWAY_GOVERNANCE_POLICY,
  gatewayGovernancePolicyFingerprint,
  loadGatewayGovernancePolicy,
  parseGatewayGovernancePolicy,
  parseGatewayGovernancePolicyForm,
} from "./policy";

describe("gateway governance policy", () => {
  it("uses the approved defaults", () => {
    expect(DEFAULT_GATEWAY_GOVERNANCE_POLICY).toEqual({
      version: 1,
      key: {
        rpm: 120,
        burst: 30,
        concurrency: 8,
        chatTokensPerMonth: 10_000_000,
        imageCountPerMonth: 1_000,
        ttsCodePointsPerMonth: 1_000_000,
        sttSecondsPerMonth: 36_000,
      },
      user: {
        rpm: 600,
        burst: 120,
        concurrency: 32,
        chatTokensPerMonth: 50_000_000,
        imageCountPerMonth: 5_000,
        ttsCodePointsPerMonth: 5_000_000,
        sttSecondsPerMonth: 180_000,
      },
    });
  });

  it("accepts only a complete versioned policy with bounded safe integers", () => {
    expect(parseGatewayGovernancePolicy(DEFAULT_GATEWAY_GOVERNANCE_POLICY))
      .toEqual(DEFAULT_GATEWAY_GOVERNANCE_POLICY);

    expect(() => parseGatewayGovernancePolicy({
      ...DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      key: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.key, rpm: 0 },
    })).toThrow();
    expect(() => parseGatewayGovernancePolicy({
      ...DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      key: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.key, rpm: 1.5 },
    })).toThrow();
    expect(() => parseGatewayGovernancePolicy({
      ...DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      key: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.key, rpm: 1_000_001 },
    })).toThrow();
    expect(() => parseGatewayGovernancePolicy({
      ...DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      extra: true,
    })).toThrow();
  });

  it("falls back only for missing or invalid stored JSON", () => {
    expect(loadGatewayGovernancePolicy(null)).toEqual({
      policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      source: "default",
    });
    expect(loadGatewayGovernancePolicy("not-json")).toEqual({
      policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      source: "invalid",
    });
    expect(loadGatewayGovernancePolicy(JSON.stringify({ version: 2 }))).toEqual({
      policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      source: "invalid",
    });
    expect(loadGatewayGovernancePolicy(JSON.stringify(DEFAULT_GATEWAY_GOVERNANCE_POLICY)))
      .toEqual({ policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY, source: "stored" });
  });

  it("produces the same fingerprint for semantically identical input", () => {
    const reordered = {
      user: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.user },
      key: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.key },
      version: 1,
    };
    expect(gatewayGovernancePolicyFingerprint(reordered))
      .toBe(gatewayGovernancePolicyFingerprint(DEFAULT_GATEWAY_GOVERNANCE_POLICY));
    expect(gatewayGovernancePolicyFingerprint({
      ...DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      key: { ...DEFAULT_GATEWAY_GOVERNANCE_POLICY.key, rpm: 121 },
    })).not.toBe(gatewayGovernancePolicyFingerprint(DEFAULT_GATEWAY_GOVERNANCE_POLICY));
  });

  it("parses the complete admin form and rejects partial or non-decimal input", () => {
    const form = policyForm();
    expect(parseGatewayGovernancePolicyForm(form)).toEqual(DEFAULT_GATEWAY_GOVERNANCE_POLICY);

    form.delete("user_stt_seconds_per_month");
    expect(() => parseGatewayGovernancePolicyForm(form)).toThrow();

    const decimal = policyForm();
    decimal.set("key_rpm", "1e2");
    expect(() => parseGatewayGovernancePolicyForm(decimal)).toThrow();
  });
});

function policyForm(): FormData {
  const form = new FormData();
  for (const [scope, limits] of Object.entries({
    key: DEFAULT_GATEWAY_GOVERNANCE_POLICY.key,
    user: DEFAULT_GATEWAY_GOVERNANCE_POLICY.user,
  })) {
    form.set(`${scope}_rpm`, String(limits.rpm));
    form.set(`${scope}_burst`, String(limits.burst));
    form.set(`${scope}_concurrency`, String(limits.concurrency));
    form.set(`${scope}_chat_tokens_per_month`, String(limits.chatTokensPerMonth));
    form.set(`${scope}_image_count_per_month`, String(limits.imageCountPerMonth));
    form.set(`${scope}_tts_code_points_per_month`, String(limits.ttsCodePointsPerMonth));
    form.set(`${scope}_stt_seconds_per_month`, String(limits.sttSecondsPerMonth));
  }
  return form;
}
