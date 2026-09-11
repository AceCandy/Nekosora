import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GATEWAY_GOVERNANCE_POLICY,
  type GatewayScopeLimits,
} from "@nekusora/core/gateway-governance/policy";

const mockFunctions = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  saveSystemSettings: vi.fn().mockResolvedValue({ revision: 5, changed: true }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/settings-control/runtime", () => ({
  invalidateSettingsRuntime: vi.fn().mockResolvedValue(false),
}));
vi.mock("next/cache", () => ({ revalidatePath: mockFunctions.revalidatePath }));
vi.mock("@/lib/session", () => ({ requireAdmin: mockFunctions.requireAdmin }));
vi.mock("@nekusora/core/settings-control/service", () => ({
  saveSystemSettings: mockFunctions.saveSystemSettings,
}));

import {
  saveGatewayGovernancePolicy,
  type GovernanceSettingsActionState,
} from "./governance-actions";

const INITIAL_STATE: GovernanceSettingsActionState = { status: "idle", error: null };
const EXPECTED = 4;
const FORM_FIELDS: readonly [keyof GatewayScopeLimits, string][] = [
  ["rpm", "rpm"],
  ["burst", "burst"],
  ["concurrency", "concurrency"],
  ["chatTokensPerMonth", "chat_tokens_per_month"],
  ["imageCountPerMonth", "image_count_per_month"],
  ["ttsCodePointsPerMonth", "tts_code_points_per_month"],
  ["sttSecondsPerMonth", "stt_seconds_per_month"],
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFunctions.requireAdmin.mockResolvedValue({ id: "admin-a", role: "admin" });
  mockFunctions.saveSystemSettings.mockResolvedValue({ revision: 5, changed: true });
});

describe("saveGatewayGovernancePolicy", () => {
  it("管理员整组保存有效策略并刷新设置页", async () => {
    const formData = policyForm();

    await expect(saveGatewayGovernancePolicy(EXPECTED, INITIAL_STATE, formData)).resolves.toEqual({
      status: "success",
      error: null,
    });
    expect(mockFunctions.requireAdmin).toHaveBeenCalledOnce();
    expect(mockFunctions.saveSystemSettings).toHaveBeenCalledWith({
      actorId: "admin-a",
      expected: EXPECTED,
      namespace: "gateway",
      values: { request_governance_v1: JSON.stringify(DEFAULT_GATEWAY_GOVERNANCE_POLICY) },
    });
    expect(mockFunctions.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("整组拒绝越界字段且不访问数据库", async () => {
    const formData = policyForm();
    formData.set("key_rpm", "0");

    await expect(saveGatewayGovernancePolicy(EXPECTED, INITIAL_STATE, formData)).resolves.toEqual({
      status: "error",
      error: "invalid",
    });
    expect(mockFunctions.saveSystemSettings).not.toHaveBeenCalled();
    expect(mockFunctions.revalidatePath).not.toHaveBeenCalled();
  });

  it("数据库保存失败时保留原页面状态且不刷新", async () => {
    mockFunctions.saveSystemSettings.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(saveGatewayGovernancePolicy(EXPECTED, INITIAL_STATE, policyForm())).resolves.toEqual({
      status: "error",
      error: "saveFailed",
    });
    expect(mockFunctions.revalidatePath).not.toHaveBeenCalled();
  });

  it("未通过管理员鉴权时拒绝执行", async () => {
    mockFunctions.requireAdmin.mockRejectedValueOnce(new Error("forbidden"));

    await expect(saveGatewayGovernancePolicy(EXPECTED, INITIAL_STATE, policyForm()))
      .rejects.toThrow("forbidden");
    expect(mockFunctions.saveSystemSettings).not.toHaveBeenCalled();
  });
});

function policyForm(): FormData {
  const formData = new FormData();
  for (const scope of ["key", "user"] as const) {
    for (const [field, suffix] of FORM_FIELDS) {
      formData.set(`${scope}_${suffix}`, String(DEFAULT_GATEWAY_GOVERNANCE_POLICY[scope][field]));
    }
  }
  return formData;
}
