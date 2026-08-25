import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  applySettingsDraft: vi.fn(),
  abandonSettingsDraft: vi.fn(),
  createRollbackDraft: vi.fn(),
  invalidateSettingsRuntime: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/settings-control/runtime", () => ({
  invalidateSettingsRuntime: mocks.invalidateSettingsRuntime,
}));
vi.mock("@/lib/settings-control/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/settings-control/service")>();
  return {
    ...original,
    applySettingsDraft: mocks.applySettingsDraft,
    abandonSettingsDraft: mocks.abandonSettingsDraft,
    createRollbackDraft: mocks.createRollbackDraft,
  };
});

import { SettingsDraftConflictError } from "@/lib/settings-control/service";
import * as settingsControlActions from "./settings-control-actions";
import { INITIAL_SETTINGS_CONTROL_ACTION_STATE } from "./settings-control-state";

const {
  abandonSettingsChangeSet,
  applySettingsChangeSet,
  createSettingsRollback,
} = settingsControlActions;

const EXPECTED = { changeSetId: "draft-1", version: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.invalidateSettingsRuntime.mockResolvedValue(false);
});

describe("settings control actions", () => {
  it("exports only server actions", () => {
    expect(Object.values(settingsControlActions).every((value) => typeof value === "function"))
      .toBe(true);
  });

  it("invalidates runtime only after the apply transaction resolves", async () => {
    mocks.applySettingsDraft.mockResolvedValue({ revision: 5, changeSetId: "draft-1" });

    await expect(applySettingsChangeSet(
      EXPECTED,
      INITIAL_SETTINGS_CONTROL_ACTION_STATE,
    )).resolves.toEqual({ status: "success", code: "applied" });

    expect(mocks.applySettingsDraft).toHaveBeenCalledWith({
      actorId: "admin-1",
      expected: EXPECTED,
    });
    expect(mocks.invalidateSettingsRuntime).toHaveBeenCalledWith(4);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("does not invalidate or refresh after a stale transaction failure", async () => {
    mocks.applySettingsDraft.mockRejectedValue(new SettingsDraftConflictError());

    await expect(applySettingsChangeSet(
      EXPECTED,
      INITIAL_SETTINGS_CONTROL_ACTION_STATE,
    )).resolves.toEqual({ status: "error", code: "stale" });

    expect(mocks.invalidateSettingsRuntime).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("abandons the exact draft and creates rollback from a selected release", async () => {
    mocks.abandonSettingsDraft.mockResolvedValue(undefined);
    await expect(abandonSettingsChangeSet(
      EXPECTED,
      INITIAL_SETTINGS_CONTROL_ACTION_STATE,
    )).resolves.toEqual({ status: "success", code: "abandoned" });

    const formData = new FormData();
    formData.set("target_change_set_id", "release-2");
    mocks.createRollbackDraft.mockResolvedValue({ id: "rollback-1" });
    await expect(createSettingsRollback(
      INITIAL_SETTINGS_CONTROL_ACTION_STATE,
      formData,
    )).resolves.toEqual({ status: "success", code: "rollback_created" });
    expect(mocks.createRollbackDraft).toHaveBeenCalledWith({
      actorId: "admin-1",
      targetChangeSetId: "release-2",
    });
  });
});
