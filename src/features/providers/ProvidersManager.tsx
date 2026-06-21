"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FormDataSerializableAction } from "@/features/providers/types";
import type { EditorRow } from "@/features/providers/KeyBundleEditor";
import ProviderFormDialog from "@/features/providers/ProviderFormDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";

export interface ProviderItem {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  enabled: boolean;
  /** 回显的明文 key(编辑时用)。 */
  keys: EditorRow[];
}

interface ProvidersManagerProps {
  providers: ProviderItem[];
  protocols: { value: string; label: string }[];
  createAction: FormDataSerializableAction;
  updateActions: Record<string, FormDataSerializableAction>;
  toggleActions: Record<string, FormDataSerializableAction>;
  deleteActions: Record<string, FormDataSerializableAction>;
}

export default function ProvidersManager({
  providers,
  protocols,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
}: ProvidersManagerProps) {
  const t = useTranslations("providers");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editing = providers.find((p) => p.id === editId) ?? null;
  const deleting = providers.find((p) => p.id === deleteId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: providers.length })}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("addProvider")}</span>
        </Button>
      </div>

      <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
        <table className="w-full text-sm border-collapse text-left">
          <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
            <tr>
              <th className="p-3.5 font-medium">{t("colName")}</th>
              <th className="p-3.5 font-medium">{t("colProtocol")}</th>
              <th className="p-3.5 font-medium">{t("colBaseUrl")}</th>
              <th className="p-3.5 font-medium text-center">{t("colKeyCount")}</th>
              <th className="p-3.5 font-medium">{t("colStatus")}</th>
              <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {providers.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  {t("emptyState")}
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                >
                  <td className="p-3.5 font-semibold text-neutral-800 dark:text-neutral-200">
                    {p.name}
                  </td>
                  <td className="p-3.5 font-mono text-xs">
                    <Badge variant="neutral" className="font-mono">
                      {p.protocol}
                    </Badge>
                  </td>
                  <td className="p-3.5 font-mono text-xs text-neutral-500 dark:text-neutral-400 max-w-[200px] truncate">
                    {p.baseUrl}
                  </td>
                  <td className="p-3.5 text-center font-mono text-xs">
                    {p.keys.length}
                  </td>
                  <td className="p-3.5">
                    <StatusDot enabled={p.enabled} />
                  </td>
                  <td className="p-3.5 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditId(p.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                      title={t("edit")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{t("edit")}</span>
                    </Button>

                    <form action={toggleActions[p.id]} className="inline">
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className={clsx(
                          p.enabled
                            ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                        )}
                        title={p.enabled ? t("disable") : t("enable")}
                      >
                        {p.enabled ? (
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

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(p.id)}
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
      <ProviderFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
        protocols={protocols}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <ProviderFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          action={updateActions[editing.id]}
          protocols={protocols}
          initial={{
            name: editing.name,
            protocol: editing.protocol,
            baseUrl: editing.baseUrl,
            keys: editing.keys,
          }}
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
