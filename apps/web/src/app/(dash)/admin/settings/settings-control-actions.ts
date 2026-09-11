"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import {
  abandonSettingsDraft,
  applySettingsDraft,
  rollbackSettings,
  getSettingsRevision,
  listSettingsHistory,
  SettingsDraftConflictError,
  SettingsRollbackConflictError,
  SettingsValidationError,
  type SettingsDraftExpectation,
} from "@nekusora/core/settings-control/service";
import { refreshSettings } from "./refresh-settings";
import type { SettingsControlActionState } from "./settings-control-state";

export async function applySettingsChangeSet(
  expected: SettingsDraftExpectation,
  _previous: SettingsControlActionState,
): Promise<SettingsControlActionState> {
  const admin = await requireAdmin();
  try {
    const applied = await applySettingsDraft({ actorId: admin.id, expected });
    const warning = await refreshSettings(applied);
    return warning
      ? { status: "warning", code: "applied_cache_warning" }
      : { status: "success", code: "applied" };
  } catch (error) {
    return actionError(error);
  }
}

export async function abandonSettingsChangeSet(
  expected: SettingsDraftExpectation,
  _previous: SettingsControlActionState,
): Promise<SettingsControlActionState> {
  const admin = await requireAdmin();
  try {
    await abandonSettingsDraft({ actorId: admin.id, expected });
    revalidatePath("/admin/settings");
    return { status: "success", code: "abandoned" };
  } catch (error) {
    return actionError(error);
  }
}

export async function createSettingsRollback(
  expected: number,
  _previous: SettingsControlActionState,
  formData: FormData,
): Promise<SettingsControlActionState> {
  const admin = await requireAdmin();
  const targetChangeSetId = String(formData.get("target_change_set_id") ?? "");
  if (!targetChangeSetId) return { status: "error", code: "invalid" };
  try {
    const saved = await rollbackSettings({ actorId: admin.id, expected, targetChangeSetId });
    const warning = await refreshSettings(saved);
    return warning
      ? { status: "warning", code: "applied_cache_warning" }
      : { status: "success", code: "rollback_created" };
  } catch (error) {
    return actionError(error);
  }
}

export async function loadSettingsHistory() {
  await requireAdmin();
  // 先取并发令牌；随后读取的历史即使更新，也只能导致安全拒绝。
  const revision = await getSettingsRevision();
  const entries = await listSettingsHistory(20);
  return {
    revision,
    history: entries.map((item) => ({
      id: item.id,
      kind: item.kind,
      rollbackOf: item.rollbackOf,
      appliedRevision: item.appliedRevision,
      appliedAt: item.appliedAt.toISOString(),
      changes: item.changes,
    })),
  };
}

function actionError(error: unknown): SettingsControlActionState {
  if (error instanceof SettingsRollbackConflictError) {
    return { status: "error", code: "rollback_conflict" };
  }
  if (error instanceof SettingsDraftConflictError) {
    return { status: "error", code: "stale" };
  }
  if (error instanceof SettingsValidationError) {
    return { status: "error", code: "invalid" };
  }
  return { status: "error", code: "failed" };
}
