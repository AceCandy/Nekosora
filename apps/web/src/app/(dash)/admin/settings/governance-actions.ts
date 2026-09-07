"use server";

import { refreshSettings } from "./refresh-settings";
import {
  parseGatewayGovernancePolicyForm,
  type GatewayGovernancePolicy,
} from "@/lib/gateway-governance/policy";
import { requireAdmin } from "@/lib/session";
import {
  saveSystemSettings,
} from "@/lib/settings-control/service";

export interface GovernanceSettingsActionState {
  status: "idle" | "success" | "error";
  error: "invalid" | "saveFailed" | null;
}

export async function saveGatewayGovernancePolicy(
  expected: number,
  _previousState: GovernanceSettingsActionState,
  formData: FormData,
): Promise<GovernanceSettingsActionState> {
  const admin = await requireAdmin();

  let policy: GatewayGovernancePolicy;
  try {
    policy = parseGatewayGovernancePolicyForm(formData);
  } catch {
    return { status: "error", error: "invalid" };
  }

  try {
    const saved = await saveSystemSettings({
      actorId: admin.id,
      expected,
      namespace: "gateway",
      values: { request_governance_v1: JSON.stringify(policy) },
    });
    await refreshSettings(saved);
    return { status: "success", error: null };
  } catch {
    return { status: "error", error: "saveFailed" };
  }
}
