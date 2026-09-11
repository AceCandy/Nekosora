/**
 * 系统设置「输出样式」Tab —— 搬自原 /admin/render-styles 独立页。
 *
 * 数据获取 + server action + Manager 渲染集中于此;revalidate 指向 /admin/settings。
 * 鉴权依赖 service 层(create/update/... 内部 requireAdmin)+ /admin layout 守卫。
 */
import { refreshSettings } from "./refresh-settings";
import {
  listAllRenderStyles,
} from "@/lib/render-styles/service";
import { requireAdmin } from "@/lib/session";
import {
  saveRenderStyleCreate,
  saveRenderStyleDelete,
  saveRenderStyleReorder,
  saveRenderStyleUpdate,
  type SettingsControlView,
} from "@nekusora/core/settings-control/service";
import RenderStylesManager from "@/features/render-styles/RenderStylesManager";

export default async function RenderStylesSection({ control }: { control: SettingsControlView }) {
  const styles = await listAllRenderStyles();
  const expected = control.currentRevision;

  const managerStyles = styles.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    cssClass: s.cssClass,
    css: s.css,
    icon: s.icon,
    renderer: s.renderer,
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
    const saved = await saveRenderStyleCreate({
      actorId: (await requireAdmin()).id,
      expected,
      value: {
        name,
        cssClass,
        css,
        description: description ?? null,
        icon: icon ?? null,
      },
    });
    await refreshSettings(saved);
  }

  async function handleUpdate(id: string, formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const css = String(formData.get("css") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const enabled = formData.get("enabled") === "on";
    if (!name || !css) return;
    const saved = await saveRenderStyleUpdate({
      actorId: (await requireAdmin()).id,
      expected,
      id,
      patch: { name, css, description: description || null, enabled },
    });
    await refreshSettings(saved);
  }

  async function handleToggle(id: string, currentEnabled: boolean) {
    "use server";
    const saved = await saveRenderStyleUpdate({
      actorId: (await requireAdmin()).id,
      expected,
      id,
      patch: { enabled: !currentEnabled },
    });
    await refreshSettings(saved);
  }

  async function handleDelete(id: string) {
    "use server";
    const saved = await saveRenderStyleDelete({ actorId: (await requireAdmin()).id, expected, id });
    await refreshSettings(saved);
  }

  /** 拖动重排:按拖动后的完整顺序重写 sortOrder,revalidate 后顺序刷新即落库。 */
  async function reorderRenderStyles(orderedIds: string[]) {
    "use server";
    const saved = await saveRenderStyleReorder({
      actorId: (await requireAdmin()).id,
      expected,
      orderedIds,
    });
    await refreshSettings(saved);
  }

  const updateActions = Object.fromEntries(
    managerStyles.map((s) => [s.id, handleUpdate.bind(null, s.id)]),
  );
  const toggleActions = Object.fromEntries(
    managerStyles.map((s) => [s.id, handleToggle.bind(null, s.id, s.enabled)]),
  );
  const deleteActions = Object.fromEntries(
    managerStyles.map((s) => [s.id, handleDelete.bind(null, s.id)]),
  );

  return (
    <div id="render-styles" className="scroll-mt-40">
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
