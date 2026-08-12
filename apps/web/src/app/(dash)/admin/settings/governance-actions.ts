"use server";

import { revalidatePath } from "next/cache";
import {
  parseGatewayGovernancePolicyForm,
  type GatewayGovernancePolicy,
} from "@/lib/gateway-governance/policy";
import { createGatewayGovernanceRepository } from "@/lib/gateway-governance/repository";
import { requireAdmin } from "@/lib/session";

export interface GovernanceSettingsActionState {
  status: "idle" | "success" | "error";
  error: "invalid" | "saveFailed" | null;
}

export async function saveGatewayGovernancePolicy(
  _previousState: GovernanceSettingsActionState,
  formData: FormData,
): Promise<GovernanceSettingsActionState> {
  await requireAdmin();

  let policy: GatewayGovernancePolicy;
  try {
    policy = parseGatewayGovernancePolicyForm(formData);
  } catch {
    return { status: "error", error: "invalid" };
  }

  try {
    const repository = await createGatewayGovernanceRepository();
    await repository.savePolicy(policy);
    revalidatePath("/admin/settings");
    return { status: "success", error: null };
  } catch {
    return { status: "error", error: "saveFailed" };
  }
}
