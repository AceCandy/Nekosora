import { revalidatePath } from "next/cache";
import { invalidateSettingsRuntime } from "@/lib/settings-control/runtime";
import type { SettingsSaveResult } from "@nekusora/core/settings-control/service";

/** 提交后的缓存刷新不能将已生效的保存误报为失败。 */
export async function refreshSettings(saved: SettingsSaveResult): Promise<boolean> {
  let warning = false;
  try {
    if (saved.changeSetId !== null) {
      warning = await invalidateSettingsRuntime(saved.revision - 1);
    }
  } catch {
    warning = true;
  }
  try {
    revalidatePath("/admin/settings");
  } catch {
    warning = true;
  }
  if (warning) console.warn("[settings] Saved; cache refresh incomplete");
  return warning;
}
