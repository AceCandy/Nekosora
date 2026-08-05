/**
 * 系统设置「输出模式」Tab —— 搬自原 /admin/output-modes 独立页。
 *
 * 数据获取 + server action + Manager 渲染集中于此;revalidate 指向 /admin/settings。
 * 鉴权依赖 service 层(create/update/... 内部 requireAdmin)+ /admin layout 守卫。
 */
import { revalidatePath } from "next/cache";
import {
  listAllOutputModes,
  createOutputMode,
  updateOutputMode,
  deleteOutputMode,
  reorderOutputModes as reorderOutputModesService,
} from "@/lib/output-modes/service";
import OutputModesManager from "@/features/output-modes/OutputModesManager";

export default async function OutputModesSection() {
  const modes = await listAllOutputModes();

  const managerModes = modes.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    systemPrompt: m.systemPrompt,
    icon: m.icon,
    enabled: m.enabled,
    sortOrder: m.sortOrder,
  }));

  async function handleCreate(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const systemPrompt = String(formData.get("system_prompt") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || undefined;
    const icon = String(formData.get("icon") ?? "").trim() || undefined;
    if (!name || !systemPrompt) return;
    await createOutputMode({ name, description, systemPrompt, icon });
    revalidatePath("/admin/settings");
  }

  async function handleUpdate(id: string, formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const systemPrompt = String(formData.get("system_prompt") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const enabled = formData.get("enabled") === "on";
    if (!name || !systemPrompt) return;
    await updateOutputMode(id, {
      name,
      systemPrompt,
      description: description || null,
      enabled,
    });
    revalidatePath("/admin/settings");
  }

  async function handleToggle(id: string, currentEnabled: boolean) {
    "use server";
    await updateOutputMode(id, { enabled: !currentEnabled });
    revalidatePath("/admin/settings");
  }

  async function handleDelete(id: string) {
    "use server";
    await deleteOutputMode(id);
    revalidatePath("/admin/settings");
  }

  /** 拖动重排:按拖动后的完整顺序重写 sortOrder,revalidate 后顺序刷新即落库。 */
  async function reorderOutputModes(orderedIds: string[]) {
    "use server";
    await reorderOutputModesService(orderedIds);
    revalidatePath("/admin/settings");
  }

  const updateActions = Object.fromEntries(
    managerModes.map((m) => [m.id, handleUpdate.bind(null, m.id)]),
  );
  const toggleActions = Object.fromEntries(
    managerModes.map((m) => [m.id, handleToggle.bind(null, m.id, m.enabled)]),
  );
  const deleteActions = Object.fromEntries(
    managerModes.map((m) => [m.id, handleDelete.bind(null, m.id)]),
  );

  return (
    <OutputModesManager
      modes={managerModes}
      createAction={handleCreate}
      updateActions={updateActions}
      toggleActions={toggleActions}
      deleteActions={deleteActions}
      reorderAction={reorderOutputModes}
    />
  );
}
