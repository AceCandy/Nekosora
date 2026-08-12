import { createHash } from "node:crypto";
import { z } from "zod";

export const GATEWAY_GOVERNANCE_NAMESPACE = "gateway";
export const GATEWAY_GOVERNANCE_POLICY_KEY = "request_governance_v1";

export const GATEWAY_GOVERNANCE_POLICY_BOUNDS = {
  rate: { min: 1, max: 1_000_000 },
  concurrency: { min: 1, max: 100_000 },
  quota: { min: 1, max: 1_000_000_000_000 },
} as const;

export type GatewayGovernancePolicyBounds = typeof GATEWAY_GOVERNANCE_POLICY_BOUNDS;

type IntegerBounds = GatewayGovernancePolicyBounds[keyof GatewayGovernancePolicyBounds];

const scopeLimitsSchema = z.object({
  rpm: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.rate),
  burst: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.rate),
  concurrency: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.concurrency),
  chatTokensPerMonth: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota),
  imageCountPerMonth: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota),
  ttsCodePointsPerMonth: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota),
  sttSecondsPerMonth: boundedInteger(GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota),
}).strict();

export const gatewayGovernancePolicySchema = z.object({
  version: z.literal(1),
  key: scopeLimitsSchema,
  user: scopeLimitsSchema,
}).strict();

export type GatewayGovernancePolicy = z.infer<typeof gatewayGovernancePolicySchema>;
export type GatewayScopeLimits = GatewayGovernancePolicy["key"];
export type GatewayPolicySource = "default" | "stored" | "invalid";

export const DEFAULT_GATEWAY_GOVERNANCE_POLICY: GatewayGovernancePolicy = {
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
};

export function parseGatewayGovernancePolicy(input: unknown): GatewayGovernancePolicy {
  return gatewayGovernancePolicySchema.parse(input);
}

export function loadGatewayGovernancePolicy(raw: string | null): {
  policy: GatewayGovernancePolicy;
  source: GatewayPolicySource;
} {
  if (raw === null) {
    return { policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY, source: "default" };
  }
  try {
    return {
      policy: parseGatewayGovernancePolicy(JSON.parse(raw)),
      source: "stored",
    };
  } catch {
    return { policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY, source: "invalid" };
  }
}

export function gatewayGovernancePolicyFingerprint(input: unknown): string {
  const policy = parseGatewayGovernancePolicy(input);
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function parseGatewayGovernancePolicyForm(formData: FormData): GatewayGovernancePolicy {
  return parseGatewayGovernancePolicy({
    version: 1,
    key: scopeFromForm(formData, "key"),
    user: scopeFromForm(formData, "user"),
  });
}

function scopeFromForm(formData: FormData, scope: "key" | "user"): GatewayScopeLimits {
  return {
    rpm: decimalFormValue(formData, `${scope}_rpm`, GATEWAY_GOVERNANCE_POLICY_BOUNDS.rate),
    burst: decimalFormValue(formData, `${scope}_burst`, GATEWAY_GOVERNANCE_POLICY_BOUNDS.rate),
    concurrency: decimalFormValue(
      formData,
      `${scope}_concurrency`,
      GATEWAY_GOVERNANCE_POLICY_BOUNDS.concurrency,
    ),
    chatTokensPerMonth: decimalFormValue(
      formData,
      `${scope}_chat_tokens_per_month`,
      GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota,
    ),
    imageCountPerMonth: decimalFormValue(
      formData,
      `${scope}_image_count_per_month`,
      GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota,
    ),
    ttsCodePointsPerMonth: decimalFormValue(
      formData,
      `${scope}_tts_code_points_per_month`,
      GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota,
    ),
    sttSecondsPerMonth: decimalFormValue(
      formData,
      `${scope}_stt_seconds_per_month`,
      GATEWAY_GOVERNANCE_POLICY_BOUNDS.quota,
    ),
  };
}

function boundedInteger(bounds: IntegerBounds) {
  return z.number().int().safe().min(bounds.min).max(bounds.max);
}

function decimalFormValue(formData: FormData, name: string, bounds: IntegerBounds): number {
  const value = formData.get(name);
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) {
    throw new Error(`Invalid governance policy field: ${name}`);
  }
  return boundedInteger(bounds).parse(Number(value));
}
