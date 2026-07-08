/**
 * 输出方式管理页(管理员)—— /admin/output-modes
 *
 * 管理员预设会话级输出模式(如「HTML 渲染」「简洁输出」),每种含一段 systemPrompt。
 * 用户在 chat 工具栏选用后,该 prompt 注入会话引导模型输出风格。
 */
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import {
  listAllOutputModes,
  createOutputMode,
  updateOutputMode,
  deleteOutputMode,
} from "@/lib/output-modes/service";
import { Sparkles } from "lucide-react";
import OutputModesManager from "@/features/output-modes/OutputModesManager";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default async function AdminOutputModesPage() {
  await requireAdmin();
  const t = await getTranslations("admin.outputModes");
  const tn = await getTranslations("nav");
  const modes = await listAllOutputModes();

  // 映射数据结构
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
    await createOutputMode({
      name,
      description,
      systemPrompt,
      icon,
    });
    revalidatePath("/admin/output-modes");
  }

  async function handleUpdate(id: string, formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const systemPrompt = String(formData.get("system_prompt") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const enabled = formData.get("enabled") === "on";
    const sortOrder = Number(formData.get("sort_order") ?? 0);
    if (!name || !systemPrompt) return;
    await updateOutputMode(id, {
      name,
      systemPrompt,
      description: description || null,
      enabled,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    });
    revalidatePath("/admin/output-modes");
  }

  async function handleToggle(id: string, currentEnabled: boolean) {
    "use server";
    await updateOutputMode(id, { enabled: !currentEnabled });
    revalidatePath("/admin/output-modes");
  }

  async function handleDelete(id: string) {
    "use server";
    await deleteOutputMode(id);
    revalidatePath("/admin/output-modes");
  }

  const updateActions = Object.fromEntries(
    managerModes.map((m) => [m.id, handleUpdate.bind(null, m.id)])
  );
  const toggleActions = Object.fromEntries(
    managerModes.map((m) => [m.id, handleToggle.bind(null, m.id, m.enabled)])
  );
  const deleteActions = Object.fromEntries(
    managerModes.map((m) => [m.id, handleDelete.bind(null, m.id)])
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-sora-blue" />
          <span>{tn("outputModes")}</span>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t("desc")}</p>
      </div>

      <OutputModesManager
        modes={managerModes}
        createAction={handleCreate}
        updateActions={updateActions}
        toggleActions={toggleActions}
        deleteActions={deleteActions}
      />
    </div>
  );
}
