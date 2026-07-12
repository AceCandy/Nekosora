/**
 * 输出样式管理页(管理员)—— /admin/render-styles
 *
 * 管理员预设会话级 Markdown 渲染样式,每种含一段 css 与稳定 cssClass。
 * 用户在 chat 工具栏选用后,AI 回答正文容器套上 rs-{cssClass} 类,
 * 配合聊天页聚合注入的 CSS 实现纯渲染层的美化展示。
 */
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import {
  listAllRenderStyles,
  createRenderStyle,
  updateRenderStyle,
  deleteRenderStyle,
  reorderRenderStyles as reorderRenderStylesService,
} from "@/lib/render-styles/service";
import { Palette } from "lucide-react";
import RenderStylesManager from "@/features/render-styles/RenderStylesManager";
import { PageHeader } from "@/shared/components/PageHeader";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default async function AdminRenderStylesPage() {
  await requireAdmin();
  const t = await getTranslations("admin.renderStyles");
  const tn = await getTranslations("nav");
  const styles = await listAllRenderStyles();

  const managerStyles = styles.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    cssClass: s.cssClass,
    css: s.css,
    icon: s.icon,
    builtin: s.builtin,
    enabled: s.enabled,
    sortOrder: s.sortOrder,
  }));

  async function handleCreate(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const cssClass = String(formData.get("css_class") ?? "").trim();
    const css = String(formData.get("css") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || undefined;
    const icon = String(formData.get("icon") ?? "").trim() || undefined;
    if (!name || !cssClass || !css) return;
    try {
      await createRenderStyle({ name, cssClass, css, description, icon });
    } catch (e) {
      // cssClass 冲突时,通过返回值提示(此处不阻断,revalidate 让表单重新渲染)
      console.error("[render-styles] create failed:", e);
    }
    revalidatePath("/admin/render-styles");
  }

  async function handleUpdate(id: string, formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const css = String(formData.get("css") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const enabled = formData.get("enabled") === "on";
    if (!name || !css) return;
    await updateRenderStyle(id, {
      name,
      css,
      description: description || null,
      enabled,
    });
    revalidatePath("/admin/render-styles");
  }

  async function handleToggle(id: string, currentEnabled: boolean) {
    "use server";
    await updateRenderStyle(id, { enabled: !currentEnabled });
    revalidatePath("/admin/render-styles");
  }

  async function handleDelete(id: string) {
    "use server";
    await deleteRenderStyle(id);
    revalidatePath("/admin/render-styles");
  }

  /** 拖动重排:按拖动后的完整顺序重写 sortOrder,revalidate 后顺序刷新即落库。 */
  async function reorderRenderStyles(orderedIds: string[]) {
    "use server";
    await reorderRenderStylesService(orderedIds);
    revalidatePath("/admin/render-styles");
  }

  const updateActions = Object.fromEntries(
    managerStyles.map((s) => [s.id, handleUpdate.bind(null, s.id)])
  );
  const toggleActions = Object.fromEntries(
    managerStyles.map((s) => [s.id, handleToggle.bind(null, s.id, s.enabled)])
  );
  const deleteActions = Object.fromEntries(
    managerStyles.map((s) => [s.id, handleDelete.bind(null, s.id)])
  );

  return (
    <div className="space-y-8">
      <PageHeader icon={Palette} title={tn("renderStyles")} desc={t("desc")} />

      <RenderStylesManager
        styles={managerStyles}
        createAction={handleCreate}
        updateActions={updateActions}
        toggleActions={toggleActions}
        deleteActions={deleteActions}
        reorderAction={reorderRenderStyles}
      />
    </div>
  );
}
