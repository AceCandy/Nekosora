"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import OutputModeFormDialog, { type OutputMode } from "./OutputModeFormDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";

interface OutputModesManagerProps {
  modes: OutputMode[];
  createAction: (formData: FormData) => void | Promise<void>;
  updateActions: Record<string, (formData: FormData) => void | Promise<void>>;
  toggleActions: Record<string, () => void | Promise<void>>;
  deleteActions: Record<string, () => void | Promise<void>>;
}

export default function OutputModesManager({
  modes,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
}: OutputModesManagerProps) {
  const t = useTranslations("admin.outputModes");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editing = modes.find((m) => m.id === editId) ?? null;
  const deleting = modes.find((m) => m.id === deleteId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: modes.length })}
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
              <th className="p-3.5 font-medium">{t("colIcon")}</th>
              <th className="p-3.5 font-medium">{t("colDesc")}</th>
              <th className="p-3.5 font-medium text-center">{t("colSortOrder")}</th>
              <th className="p-3.5 font-medium">{t("colStatus")}</th>
              <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {modes.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              modes.map((m) => (
                <tr
                  key={m.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                >
                  <td className="p-3.5 font-semibold text-neutral-800 dark:text-white">
                    {m.name}
                  </td>
                  <td className="p-3.5 font-mono text-xs">
                    {m.icon ? (
                      <Badge variant="neutral" className="font-mono text-xs py-0.5">
                        {m.icon}
                      </Badge>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-600">-</span>
                    )}
                  </td>
                  <td className="p-3.5 text-xs text-neutral-500 dark:text-neutral-400 max-w-[240px] truncate" title={m.description ?? ""}>
                    {m.description || <span className="text-neutral-400 dark:text-neutral-600">-</span>}
                  </td>
                  <td className="p-3.5 text-center font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {m.sortOrder}
                  </td>
                  <td className="p-3.5">
                    <StatusDot enabled={m.enabled} label={m.enabled ? undefined : t("disabled")} />
                  </td>
                  <td className="p-3.5 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditId(m.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                      title={t("save")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{t("save")}</span>
                    </Button>

                    <form action={toggleActions[m.id]} className="inline">
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className={clsx(
                          m.enabled
                            ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                        )}
                        title={m.enabled ? t("disabled") : t("enabled")}
                      >
                        {m.enabled ? (
                          <>
                            <Square className="w-3.5 h-3.5 fill-current" />
                            <span>{t("disabled")}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{t("enabled")}</span>
                          </>
                        )}
                      </Button>
                    </form>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(m.id)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                      title={t("delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t("delete")}</span>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增弹窗 */}
      <OutputModeFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <OutputModeFormDialog
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
