"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import RenderStyleFormDialog, { type RenderStyle } from "./RenderStyleFormDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert, Lock } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";

interface RenderStylesManagerProps {
  styles: RenderStyle[];
  createAction: (formData: FormData) => void | Promise<void>;
  updateActions: Record<string, (formData: FormData) => void | Promise<void>>;
  toggleActions: Record<string, () => void | Promise<void>>;
  deleteActions: Record<string, () => void | Promise<void>>;
}

export default function RenderStylesManager({
  styles,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
}: RenderStylesManagerProps) {
  const t = useTranslations("admin.renderStyles");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editing = styles.find((s) => s.id === editId) ?? null;
  const deleting = styles.find((s) => s.id === deleteId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: styles.length })}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("addBtn")}</span>
        </Button>
      </div>

      <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
        <table className="w-full text-sm border-collapse text-left">
          <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
            <tr>
              <th className="p-3.5 font-medium">{t("colName")}</th>
              <th className="p-3.5 font-medium">{t("colCssClass")}</th>
              <th className="p-3.5 font-medium">{t("colDesc")}</th>
              <th className="p-3.5 font-medium text-center">{t("colSortOrder")}</th>
              <th className="p-3.5 font-medium">{t("colStatus")}</th>
              <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {styles.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              styles.map((s) => (
                <tr
                  key={s.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                >
                  <td className="p-3.5 font-semibold text-neutral-800 dark:text-white">
                    <span className="inline-flex items-center gap-1.5">
                      {s.name}
                      {s.builtin && (
                        <Lock className="w-3 h-3 text-neutral-400" aria-label={t("builtin")} />
                      )}
                    </span>
                  </td>
                  <td className="p-3.5 font-mono text-xs">
                    <Badge variant="neutral" className="font-mono text-xs py-0.5">
                      {s.cssClass}
                    </Badge>
                  </td>
                  <td className="p-3.5 text-xs text-neutral-500 dark:text-neutral-400 max-w-[240px] truncate" title={s.description ?? ""}>
                    {s.description || <span className="text-neutral-400 dark:text-neutral-600">-</span>}
                  </td>
                  <td className="p-3.5 text-center font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {s.sortOrder}
                  </td>
                  <td className="p-3.5">
                    <StatusDot enabled={s.enabled} label={s.enabled ? undefined : t("disabled")} />
                  </td>
                  <td className="p-3.5 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditId(s.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                      title={t("edit")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{t("edit")}</span>
                    </Button>

                    <form action={toggleActions[s.id]} className="inline">
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className={clsx(
                          s.enabled
                            ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                        )}
                        title={s.enabled ? t("disable") : t("enable")}
                      >
                        {s.enabled ? (
                          <>
                            <Square className="w-3.5 h-3.5 fill-current" />
                            <span>{t("disable")}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{t("enable")}</span>
                          </>
                        )}
                      </Button>
                    </form>

                    {s.builtin ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled
                        className="text-neutral-300 dark:text-neutral-700 cursor-not-allowed"
                        title={t("builtinNoDelete")}
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(s.id)}
                        className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                        title={t("delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t("delete")}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增弹窗 */}
      <RenderStyleFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <RenderStyleFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          action={updateActions[editing.id]}
          initial={editing}
        />
      )}

      {/* 删除二次确认弹窗 */}
      {deleting && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteId(null)}
          title={t("deleteTitle")}
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                {t("deleteConfirm", { name: deleting.name })}
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal">
                  {t("deleteWarning")}
                </p>
              </div>
            </div>
          }
          confirmLabel={t("deleteButton")}
          danger
          action={deleteActions[deleting.id]}
        />
      )}
    </div>
  );
}
