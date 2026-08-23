"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import {
  abandonSettingsDraft,
  applySettingsDraft,
  createRollbackDraft,
  SettingsDraftConflictError,
  SettingsRollbackConflictError,
  SettingsValidationError,
  type SettingsDraftExpectation,
} from "@/lib/settings-control/service";
import { invalidateSettingsRuntime } from "@/lib/settings-control/runtime";

export interface SettingsControlActionState {
  status: "idle" | "success" | "warning" | "error";
  code:
    | "applied"
    | "applied_cache_warning"
    | "abandoned"
    | "rollback_created"
    | "stale"
    | "rollback_conflict"
    | "invalid"
    | "failed"
    | null;
}

export const INITIAL_SETTINGS_CONTROL_ACTION_STATE: SettingsControlActionState = {
  status: "idle",
  code: null,
};

export async function applySettingsChangeSet(
  expected: SettingsDraftExpectation,
  _previous: SettingsControlActionState,
): Promise<SettingsControlActionState> {
  const admin = await requireAdmin();
  try {
    const applied = await applySettingsDraft({ actorId: admin.id, expected });
    const warning = await invalidateSettingsRuntime(applied.revision - 1);
    revalidatePath("/admin/settings");
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
  _previous: SettingsControlActionState,
  formData: FormData,
): Promise<SettingsControlActionState> {
  const admin = await requireAdmin();
  const targetChangeSetId = String(formData.get("target_change_set_id") ?? "");
  if (!targetChangeSetId) return { status: "error", code: "invalid" };
  try {
    await createRollbackDraft({ actorId: admin.id, targetChangeSetId });
    revalidatePath("/admin/settings");
    return { status: "success", code: "rollback_created" };
  } catch (error) {
    return actionError(error);
  }
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
