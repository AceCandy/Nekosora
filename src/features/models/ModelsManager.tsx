"use client";
import { Fragment, useState, useOptimistic, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ModelCapabilities } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import ModelFormDialog, {
  type ModelInitial,
} from "@/features/models/ModelFormDialog";
import RouteFormDialog from "@/features/models/RouteFormDialog";
import RouteTestButton, { type RouteTestAction } from "@/features/models/RouteTestButton";
import ModelSyncChecker, { type SyncStatus } from "@/features/models/ModelSyncChecker";
import type { FetchModelsAction } from "@/features/models/UpstreamModelPicker";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert, GitCommit, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
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
  visibility?: string;
  enabled: boolean;
  systemPrompt?: string | null;
  description?: string | null;
  capabilities?: ModelCapabilities | null;
  routeCount?: number;
  /** 全局/个人模型均传,拖动落库用。 */
  sortOrder?: number;
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
  /** admin 可见 visibility 列 + 「发布到全局」开关;普通用户恒 private,不显示该列。 */
  isAdmin?: boolean;
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
  /** 拖动重排 action(全局/个人模型均可传入);不传则表格不启用拖动。 */
  reorderAction?: (orderedIds: string[]) => void | Promise<void>;
}

export default function ModelsManager({
  isAdmin = false,
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
  reorderAction,
}: ModelsManagerProps) {
  const t = useTranslations("models");
  // visibility 列仅 admin 可见;普通用户模型恒 private,不显示该列。
  const showVisibility = isAdmin;
  // 所有模型均可拖动(需 reorderAction + sortOrder 链路)。
  const reorderable = Boolean(reorderAction);
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const [routeAddModelId, setRouteAddModelId] = useState<string | null>(null);
  const [routeEditId, setRouteEditId] = useState<string | null>(null);
  const [routeDeleteId, setRouteDeleteId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // 乐观顺序:拖动时立即按新 id 顺序重排渲染,revalidate 后自动对齐真实数据(顺序一致)。
  const [optimisticModels, setOptimisticModels] = useOptimistic(
    models,
    (state, orderedIds: string[]) => {
      const map = new Map(state.map((m) => [m.id, m]));
      return orderedIds
        .map((id) => map.get(id))
        .filter((m): m is ModelItem => Boolean(m));
    },
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const editing = optimisticModels.find((m) => m.id === editId) ?? null;
  const deleting = optimisticModels.find((m) => m.id === deleteId) ?? null;
  const routeEditing = routes?.find((r) => r.id === routeEditId) ?? null;
  const routeDeleting = routes?.find((r) => r.id === routeDeleteId) ?? null;

  // 列数:基础列(showVisibility ? 7 : 6)+ 拖动手柄列(可拖动时 +1)。空态 / 展开行 colSpan 用此值。
  const colCount = (showVisibility ? 7 : 6) + (reorderable ? 1 : 0);

  function handleDragEnd(event: DragEndEvent) {
    if (!reorderAction) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = optimisticModels.map((m) => m.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    // async transition:await server action 期间 transition 保持 pending,useOptimistic
    // 乐观态持续到 revalidate 送回真实数据(顺序一致),避免「新序→旧序→新序」闪动。
    // 与本仓所有 startTransition(async () => await ...Action()) 约定一致。
    startTransition(async () => {
      setOptimisticModels(newIds);
      await reorderAction(newIds);
    });
  }

  const tableEl = (
    <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
      <table className="w-full text-sm border-collapse text-left">
        <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
          <tr>
            {reorderable && <th className="p-3.5 w-8" />}
            <th className="p-3.5 font-medium">{t("colExternalName")}</th>
            <th className="p-3.5 font-medium">{t("colDisplayName")}</th>
            <th className="p-3.5 font-medium">{t("colVendor")}</th>
            {showVisibility && <th className="p-3.5 font-medium">{t("colVisibility")}</th>}
            <th className="p-3.5 font-medium text-center">{t("colRouteCount")}</th>
            <th className="p-3.5 font-medium">{t("colStatus")}</th>
            <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
          {optimisticModels.length === 0 ? (
            <tr>
              <td
                colSpan={colCount}
                className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500"
              >
                {t("emptyState")}
              </td>
            </tr>
          ) : reorderable ? (
            <SortableContext items={optimisticModels.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              {optimisticModels.map((m) => {
                const modelRoutes = routes?.filter((r) => r.modelId === m.id) ?? [];
                const expanded = expandedModel === m.id;
                return (
                  <SortableModelRow
                    key={m.id}
                    model={m}
                    routes={modelRoutes}
                    hasVisibility={showVisibility}
                    routeCount={modelRoutes.length}
                    expanded={expanded}
                    colSpan={colCount}
                    onToggleExpand={() => setExpandedModel(expanded ? null : m.id)}
                    onEdit={() => setEditId(m.id)}
                    onDelete={() => setDeleteId(m.id)}
                    toggleAction={toggleActions[m.id]}
                    onAddRoute={() => setRouteAddModelId(m.id)}
                    onEditRoute={(rid) => setRouteEditId(rid)}
                    onDeleteRoute={(rid) => setRouteDeleteId(rid)}
                    routeToggleActions={toggleRouteActions}
                    testRouteActions={testRouteActions}
                    fetchModelsAction={fetchModelsAction}
                  />
                );
              })}
            </SortableContext>
          ) : (
            optimisticModels.map((m) => {
              const modelRoutes = routes?.filter((r) => r.modelId === m.id) ?? [];
              const expanded = expandedModel === m.id;
              return (
                <Fragment key={m.id}>
                  <tr className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150">
                    <ModelRowCells
                      model={m}
                      hasVisibility={showVisibility}
                      routeCount={modelRoutes.length}
                      expanded={expanded}
                      onToggleExpand={() => setExpandedModel(expanded ? null : m.id)}
                      onEdit={() => setEditId(m.id)}
                      onDelete={() => setDeleteId(m.id)}
                      toggleAction={toggleActions[m.id]}
                    />
                  </tr>
                  {expanded && (
                    <RouteExpandRow
                      colSpan={colCount}
                      routes={modelRoutes}
                      onAdd={() => setRouteAddModelId(m.id)}
                      onEdit={(rid) => setRouteEditId(rid)}
                      onDelete={(rid) => setRouteDeleteId(rid)}
                      toggleActions={toggleRouteActions}
                      testActions={testRouteActions}
                      fetchModelsAction={fetchModelsAction}
                    />
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: optimisticModels.length })}
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

      {reorderable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {tableEl}
        </DndContext>
      ) : (
        tableEl
      )}

      <ModelFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        isAdmin={isAdmin}
        action={createAction}
      />
      {editing && (
        <ModelFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          isAdmin={isAdmin}
          action={updateActions[editing.id]}
          initial={{
            name: editing.name,
            displayName: editing.displayName,
            vendor: editing.vendor ?? "",
            visibility: editing.visibility as "public" | "private",
            systemPrompt: editing.systemPrompt ?? "",
            description: editing.description ?? "",
            capabilities: editing.capabilities ?? {},
          } satisfies ModelInitial}
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
                  {t("deleteModelWarning")}
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

/** 模型主行的内容单元格(名称/显示名/厂商/可见性/路由数/状态/操作)。拖动手柄由外层行组件提供。 */
function ModelRowCells({
  model,
  hasVisibility,
  routeCount,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
  toggleAction,
}: {
  model: ModelItem;
  hasVisibility: boolean;
  routeCount: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  toggleAction: FormDataSerializableAction;
}) {
  const t = useTranslations("models");
  return (
    <>
      <td className="p-3.5 font-mono text-xs font-semibold text-neutral-800 dark:text-neutral-200">
        {model.name}
      </td>
      <td className="p-3.5 text-xs text-neutral-600 dark:text-neutral-300">
        {model.displayName ?? "-"}
      </td>
      <td className="p-3.5 text-xs">
        {model.vendor ? (
          <Badge variant="neutral" className="font-mono text-[10px]">
            {model.vendor}
          </Badge>
        ) : (
          "-"
        )}
      </td>
      {hasVisibility && (
        <td className="p-3.5 text-xs">
          <Badge variant={model.visibility === "public" ? "success" : "warning"}>
            {model.visibility === "public" ? t("visibilityPublic") : t("visibilityPrivate")}
          </Badge>
        </td>
      )}
      <td className="p-3.5 text-center font-mono text-xs">
        {routeCount}
      </td>
      <td className="p-3.5">
        <StatusDot enabled={model.enabled} />
      </td>
      <td className="p-3.5 text-right space-x-1 whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleExpand}
          className={clsx(
            expanded
              ? "text-neutral-800 dark:text-white bg-neutral-100 dark:bg-neutral-800"
              : "text-sora-blue hover:bg-blue-50 dark:hover:bg-blue-950/20"
          )}
          title={t("configureRoutes")}
        >
          <GitCommit className="w-3.5 h-3.5" />
          <span>{t("routesWithCount", { count: routeCount })}</span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
          title={t("edit")}
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span>{t("edit")}</span>
        </Button>
        <form action={toggleAction} className="inline">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className={clsx(
              model.enabled
                ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
            )}
            title={model.enabled ? t("disable") : t("enable")}
          >
            {model.enabled ? (
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
          onClick={onDelete}
          className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
          title={t("delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t("delete")}</span>
        </Button>
      </td>
    </>
  );
}

/** 展开的网关路由面板行(跨整行 colSpan)。拖动中由外层决定是否渲染。 */
function RouteExpandRow({
  colSpan,
  routes,
  onAdd,
  onEdit,
  onDelete,
  toggleActions,
  testActions,
  fetchModelsAction,
}: {
  colSpan: number;
  routes: RouteItem[];
  onAdd: () => void;
  onEdit: (routeId: string) => void;
  onDelete: (routeId: string) => void;
  toggleActions?: Record<string, FormDataSerializableAction>;
  testActions?: Record<string, RouteTestAction>;
  fetchModelsAction?: FetchModelsAction;
}) {
  return (
    <tr className="bg-neutral-50/40 dark:bg-neutral-900/10">
      <td colSpan={colSpan} className="p-4 border-t border-neutral-100 dark:border-neutral-800/60">
        <RouteListPanel
          routes={routes}
          onAdd={onAdd}
          onEdit={onEdit}
          onDelete={onDelete}
          toggleActions={toggleActions}
          testActions={testActions}
          fetchModelsAction={fetchModelsAction}
        />
      </td>
    </tr>
  );
}

/**
 * 可拖动模型行(全局/个人模型均可)。useSortable 必须在独立组件内调用(不能在 .map 回调里)。
 * 双 `<tr>` 策略:setNodeRef/transform/listeners 只绑在主 `<tr>`;展开路由 `<tr>` 不注册为
 * sortable item,作为兄弟 tr 跟随。拖拽中(isDragging)收起自身展开行,避免视觉错位;松手恢复。
 */
function SortableModelRow({
  model,
  routes,
  hasVisibility,
  routeCount,
  expanded,
  colSpan,
  onToggleExpand,
  onEdit,
  onDelete,
  toggleAction,
  onAddRoute,
  onEditRoute,
  onDeleteRoute,
  routeToggleActions,
  testRouteActions,
  fetchModelsAction,
}: {
  model: ModelItem;
  routes: RouteItem[];
  hasVisibility: boolean;
  routeCount: number;
  expanded: boolean;
  colSpan: number;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  toggleAction: FormDataSerializableAction;
  onAddRoute: () => void;
  onEditRoute: (routeId: string) => void;
  onDeleteRoute: (routeId: string) => void;
  routeToggleActions?: Record<string, FormDataSerializableAction>;
  testRouteActions?: Record<string, RouteTestAction>;
  fetchModelsAction?: FetchModelsAction;
}) {
  const t = useTranslations("models");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { opacity: 0.4 } : {}),
  };
  return (
    <Fragment>
      <tr
        ref={setNodeRef}
        style={style}
        className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150"
      >
        <td className="p-3.5 text-center align-middle">
          <button
            type="button"
            aria-label={t("dragHandle")}
            className="cursor-grab active:cursor-grabbing inline-flex items-center justify-center text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        </td>
        <ModelRowCells
          model={model}
          hasVisibility={hasVisibility}
          routeCount={routeCount}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          onEdit={onEdit}
          onDelete={onDelete}
          toggleAction={toggleAction}
        />
      </tr>
      {/* 拖拽中收起展开行:主行正被拖动时隐藏其下方路由面板,松手后恢复。 */}
      {expanded && !isDragging && (
        <RouteExpandRow
          colSpan={colSpan}
          routes={routes}
          onAdd={onAddRoute}
          onEdit={onEditRoute}
          onDelete={onDeleteRoute}
          toggleActions={routeToggleActions}
          testActions={testRouteActions}
          fetchModelsAction={fetchModelsAction}
        />
      )}
    </Fragment>
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
