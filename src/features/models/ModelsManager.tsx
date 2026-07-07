"use client";
import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import type { ModelCapabilities } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import ModelFormDialog, {
  type GlobalModelInitial,
  type ByoModelInitial,
} from "@/features/models/ModelFormDialog";
import RouteFormDialog from "@/features/models/RouteFormDialog";
import RouteTestButton, { type RouteTestAction } from "@/features/models/RouteTestButton";
import ModelSyncChecker, { type SyncStatus } from "@/features/models/ModelSyncChecker";
import type { FetchModelsAction } from "@/features/models/UpstreamModelPicker";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert, GitCommit, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";

// ---------- 共享数据形状 ----------

export interface ModelItem {
  id: string;
  name: string;
  displayName?: string;
  vendor?: string | null;
  accessScope?: string;
  enabled: boolean;
  systemPrompt?: string | null;
  description?: string | null;
  capabilities?: ModelCapabilities | null;
  routeCount?: number;
}

export interface RouteItem {
  id: string;
  modelId: string;
  providerId: string;
  providerName: string;
  upstreamModelName: string;
  priority: number;
  weight: number;
  enabled: boolean;
}

export interface ProviderOption {
  id: string;
  name: string;
}

interface ModelsManagerProps {
  variant: "global" | "byo";
  models: ModelItem[];
  routes?: RouteItem[];
  providers?: ProviderOption[];

  createAction: FormDataSerializableAction;
  updateActions: Record<string, FormDataSerializableAction>;
  deleteActions: Record<string, FormDataSerializableAction>;
  toggleActions: Record<string, FormDataSerializableAction>;
  createRouteActions?: Record<string, FormDataSerializableAction>;
  updateRouteActions?: Record<string, FormDataSerializableAction>;
  deleteRouteActions?: Record<string, FormDataSerializableAction>;
  toggleRouteActions?: Record<string, FormDataSerializableAction>;
  /** 拉取上游模型列表的 action(路由表单拉取上游模型 / 同步检查用)。不传则不显示拉取按钮。 */
  fetchModelsAction?: FetchModelsAction;
  /** 路由测试 action(按 routeId 索引)。不传则路由行不显示测试按钮。 */
  testRouteActions?: Record<string, RouteTestAction>;
}

export default function ModelsManager({
  variant,
  models,
  routes,
  providers,
  createAction,
  updateActions,
  deleteActions,
  toggleActions,
  createRouteActions,
  updateRouteActions,
  deleteRouteActions,
  toggleRouteActions,
  fetchModelsAction,
  testRouteActions,
}: ModelsManagerProps) {
  const t = useTranslations("models");
  const isAdmin = variant === "global";
  // 个人模型私有(userId 隔离),不存在 public/internal 范围;仅全局模型有 accessScope 列。
  const hasAccessScope = isAdmin;
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const [routeAddModelId, setRouteAddModelId] = useState<string | null>(null);
  const [routeEditId, setRouteEditId] = useState<string | null>(null);
  const [routeDeleteId, setRouteDeleteId] = useState<string | null>(null);

  const editing = models.find((m) => m.id === editId) ?? null;
  const deleting = models.find((m) => m.id === deleteId) ?? null;
  const routeEditing = routes?.find((r) => r.id === routeEditId) ?? null;
  const routeDeleting = routes?.find((r) => r.id === routeDeleteId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: models.length })}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("addModel")}</span>
        </Button>
      </div>

      <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
        <table className="w-full text-sm border-collapse text-left">
          <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
            <tr>
              <th className="p-3.5 font-medium">{t("colExternalName")}</th>
              <th className="p-3.5 font-medium">{t("colDisplayName")}</th>
              <th className="p-3.5 font-medium">{t("colVendor")}</th>
              {hasAccessScope && <th className="p-3.5 font-medium">{t("colAccessScope")}</th>}
              <th className="p-3.5 font-medium text-center">{t("colRouteCount")}</th>
              <th className="p-3.5 font-medium">{t("colStatus")}</th>
              <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {models.length === 0 ? (
              <tr>
                <td
                  colSpan={hasAccessScope ? 7 : 6}
                  className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500"
                >
                  {t("emptyState")}
                </td>
              </tr>
            ) : (
              models.map((m) => {
                const modelRoutes = routes?.filter((r) => r.modelId === m.id) ?? [];
                const expanded = expandedModel === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150">
                      <td className="p-3.5 font-mono text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                        {m.name}
                      </td>
                      <td className="p-3.5 text-xs text-neutral-600 dark:text-neutral-300">
                        {m.displayName ?? "-"}
                      </td>
                      <td className="p-3.5 text-xs">
                        {m.vendor ? (
                          <Badge variant="neutral" className="font-mono text-[10px]">
                            {m.vendor}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </td>
                      {hasAccessScope && (
                        <td className="p-3.5 text-xs">
                          <Badge variant={m.accessScope === "public" ? "success" : "warning"}>
                            {m.accessScope === "public" ? t("scopePublic") : t("scopeInternal")}
                          </Badge>
                        </td>
                      )}
                      <td className="p-3.5 text-center font-mono text-xs">
                        {modelRoutes.length}
                      </td>
                      <td className="p-3.5">
                        <StatusDot enabled={m.enabled} />
                      </td>
                      <td className="p-3.5 text-right space-x-1 whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedModel(expanded ? null : m.id)
                          }
                          className={clsx(
                            expanded
                              ? "text-neutral-800 dark:text-white bg-neutral-100 dark:bg-neutral-800"
                              : "text-sora-blue hover:bg-blue-50 dark:hover:bg-blue-950/20"
                          )}
                          title={t("configureRoutes")}
                        >
                          <GitCommit className="w-3.5 h-3.5" />
                          <span>{t("routesWithCount", { count: modelRoutes.length })}</span>
                          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditId(m.id)}
                          className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                          title={t("edit")}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>{t("edit")}</span>
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
                            title={m.enabled ? t("disable") : t("enable")}
                          >
                            {m.enabled ? (
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
                          onClick={() => setDeleteId(m.id)}
                          className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                          title={t("delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t("delete")}</span>
                        </Button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-neutral-50/40 dark:bg-neutral-900/10">
                        <td colSpan={hasAccessScope ? 7 : 6} className="p-4 border-t border-neutral-100 dark:border-neutral-800/60">
                          <RouteListPanel
                            routes={modelRoutes}
                            onAdd={() => setRouteAddModelId(m.id)}
                            onEdit={(rid) => setRouteEditId(rid)}
                            onDelete={(rid) => setRouteDeleteId(rid)}
                            toggleActions={toggleRouteActions}
                            testActions={testRouteActions}
                            fetchModelsAction={fetchModelsAction}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ModelFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        variant={variant}
        action={createAction}
      />
      {editing && (
        <ModelFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          variant={variant}
          action={updateActions[editing.id]}
          initial={
            isAdmin
              ? ({
                  name: editing.name,
                  displayName: editing.displayName,
                  vendor: editing.vendor ?? "",
                  accessScope: editing.accessScope as "public" | "internal",
                  systemPrompt: editing.systemPrompt ?? "",
                  description: editing.description ?? "",
                  capabilities: editing.capabilities ?? {},
                } satisfies GlobalModelInitial)
              : ({
                  name: editing.name,
                  displayName: editing.displayName,
                  vendor: editing.vendor ?? "",
                  systemPrompt: editing.systemPrompt ?? "",
                  description: editing.description ?? "",
                  capabilities: editing.capabilities ?? {},
                } satisfies ByoModelInitial)
          }
        />
      )}

      {routeAddModelId && createRouteActions?.[routeAddModelId] && (
        <RouteFormDialog
          open={true}
          onClose={() => setRouteAddModelId(null)}
          mode="add"
          action={createRouteActions[routeAddModelId]}
          providers={providers ?? []}
          fetchModelsAction={fetchModelsAction}
        />
      )}
      {routeEditing && updateRouteActions?.[routeEditing.id] && (
        <RouteFormDialog
          open={true}
          onClose={() => setRouteEditId(null)}
          mode="edit"
          action={updateRouteActions[routeEditing.id]}
          providers={providers ?? []}
          fetchModelsAction={fetchModelsAction}
          initial={{
            providerId: routeEditing.providerId,
            upstreamModelName: routeEditing.upstreamModelName,
            priority: routeEditing.priority,
            weight: routeEditing.weight,
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteId(null)}
          title={t("deleteModelTitle")}
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                {t("deleteModelConfirm", { name: deleting.name })}
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal">
                  {isAdmin ? t("deleteGlobalWarning") : t("deleteByoWarning")}
                </p>
              </div>
            </div>
          }
          confirmLabel={t("confirmDelete")}
          danger
          action={deleteActions[deleting.id]}
        />
      )}

      {routeDeleting && deleteRouteActions?.[routeDeleting.id] && (
        <ConfirmDialog
          open={true}
          onClose={() => setRouteDeleteId(null)}
          title={t("deleteRouteTitle")}
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                {t("deleteRouteConfirm", { name: routeDeleting.providerName })}
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal font-mono">
                  {t("upstreamModelLabel", { name: routeDeleting.upstreamModelName })}
                </p>
              </div>
            </div>
          }
          confirmLabel={t("confirmDelete")}
          danger
          action={deleteRouteActions[routeDeleting.id]}
        />
      )}
    </div>
  );
}

interface RouteListPanelProps {
  routes: RouteItem[];
  onAdd: () => void;
  onEdit: (routeId: string) => void;
  onDelete: (routeId: string) => void;
  toggleActions?: Record<string, FormDataSerializableAction>;
  /** 每条路由的可用性测试 action(按 routeId)。不传则不显示测试按钮。 */
  testActions?: Record<string, RouteTestAction>;
  /** 拉取上游模型列表的 action(同步状态检查用)。不传则不显示检查按钮。 */
  fetchModelsAction?: FetchModelsAction;
}

function RouteListPanel({
  routes,
  onAdd,
  onEdit,
  onDelete,
  toggleActions,
  testActions,
  fetchModelsAction,
}: RouteListPanelProps) {
  const t = useTranslations("models");
  // 路由级同步状态:routeId → synced/local-only/unknown。空表示未检查。
  const [syncMap, setSyncMap] = useState<Record<string, SyncStatus>>({});
  return (
    <div className="space-y-3 p-4 rounded-lg bg-neutral-50/50 dark:bg-neutral-950/20 border border-neutral-200/65 dark:border-neutral-800/80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("routePanelHint")}
          </span>
          {fetchModelsAction && routes.length > 0 && (
            <ModelSyncChecker
              routes={routes}
              fetchAction={fetchModelsAction}
              onResult={setSyncMap}
            />
          )}
        </div>
        <Button
          type="button"
          variant="contrast"
          size="xs"
          onClick={onAdd}
          className="font-semibold"
        >
          <Plus className="w-3 h-3" />
          <span>{t("addRoute")}</span>
        </Button>
      </div>

      {routes.length === 0 ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500 py-3 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded">
          {t("noRoutesHint")}
        </p>
      ) : (
        <div className="rounded-md border border-morning-mist dark:border-deep-space overflow-hidden bg-nebula-white dark:bg-twilight-obsidian">
          <table className="w-full text-xs text-left">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 font-mono text-[10px] uppercase border-b border-morning-mist dark:border-deep-space">
              <tr>
                <th className="p-2.5 font-medium">{t("colUpstreamProvider")}</th>
                <th className="p-2.5 font-medium">{t("colUpstreamModelName")}</th>
                <th className="p-2.5 font-medium text-center">{t("colPriority")}</th>
                <th className="p-2.5 font-medium text-center">{t("colWeight")}</th>
                <th className="p-2.5 font-medium">{t("colStatus")}</th>
                <th className="p-2.5 font-medium text-right">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
              {routes.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors"
                >
                  <td className="p-2.5 font-medium text-neutral-850 dark:text-neutral-200">{r.providerName}</td>
                  <td className="p-2.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                    <span className="inline-flex items-center gap-1.5">
                      {r.upstreamModelName}
                      {syncMap[r.id] === "synced" && (
                        <Badge variant="success">{t("syncSynced")}</Badge>
                      )}
                      {syncMap[r.id] === "local-only" && (
                        <Badge variant="danger" title={t("syncLocalOnlyHint")}>{t("syncLocalOnly")}</Badge>
                      )}
                    </span>
                  </td>
                  <td className="p-2.5 text-center font-mono text-[11px] font-semibold">{r.priority}</td>
                  <td className="p-2.5 text-center font-mono text-[11px] font-semibold">{r.weight}</td>
                  <td className="p-2.5">
                    <StatusDot enabled={r.enabled} />
                  </td>
                  <td className="p-2.5 text-right space-x-1 whitespace-nowrap">
                    {testActions?.[r.id] && (
                      <RouteTestButton action={testActions[r.id]} id={r.id} />
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onEdit(r.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>{t("edit")}</span>
                    </Button>
                    {toggleActions?.[r.id] && (
                      <form action={toggleActions[r.id]} className="inline">
                        <Button
                          type="submit"
                          variant="ghost"
                          size="xs"
                          className={clsx(
                            r.enabled
                              ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                              : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                          )}
                        >
                          {r.enabled ? (
                            <>
                              <Square className="w-3 h-3 fill-current" />
                              <span>{t("disable")}</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>{t("enable")}</span>
                            </>
                          )}
                        </Button>
                      </form>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onDelete(r.id)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                    >
                      {t("delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-neutral-400">
        {t("priorityWeightTip")}
      </p>
    </div>
  );
}
