"use client";
import { Fragment, useState, useOptimistic, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
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
import type { ModelCapabilities, RouteApiFormat } from "@/db/types";
import type { FormDataSerializableAction } from "@/features/providers/types";
import ModelFormDialog, {
  type ModelInitial,
} from "@/features/models/ModelFormDialog";
import RouteFormDialog, { type RouteProviderOption } from "@/features/models/RouteFormDialog";
import RouteTestButton, { type RouteTestAction } from "@/features/models/RouteTestButton";
import ModelSyncChecker, { type SyncStatus } from "@/features/models/ModelSyncChecker";
import type { FetchModelsAction } from "@/features/models/UpstreamModelPicker";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Popover from "@/shared/ui/Popover";
import CatalogDetailCard from "@/features/models/CatalogDetailCard";
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
  catalogId: string;
  catalogName: string;
  modelType: string;
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
  providerEnabled: boolean;
  upstreamModelName: string;
  apiFormat: RouteApiFormat;
  priority: number;
  weight: number;
  supportsTools: boolean;
  enabled: boolean;
}

export type ProviderOption = RouteProviderOption;

type ModelVisibility = "public" | "private";

export interface ModelVisibilityActions {
  publish: FormDataSerializableAction;
  makePrivate: FormDataSerializableAction;
}

interface ModelsManagerProps {
  /** admin 可见 visibility 列 + 「发布到全局」开关;普通用户恒 private,不显示该列。 */
  isAdmin?: boolean;
  models: ModelItem[];
  routes?: RouteItem[];
  providers?: ProviderOption[];
  catalog?: ModelCatalogOption[];

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
  /** 管理员按可见性分组重排的 action。 */
  groupedReorderAction?: (visibility: ModelVisibility, orderedIds: string[]) => void | Promise<void>;
  /** 管理员列表中的发布/收回 action(按模型 id 索引)。 */
  visibilityActions?: Record<string, ModelVisibilityActions>;
  createInitial?: ModelInitial;
}

export interface ModelCatalogOption {
  id: string;
  name: string;
  canonicalModelId: string;
  modelType: string;
  capabilities: ModelCapabilities;
}

export default function ModelsManager({
  isAdmin = false,
  models,
  routes,
  providers,
  catalog = [],
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
  groupedReorderAction,
  visibilityActions,
  createInitial,
}: ModelsManagerProps) {
  const t = useTranslations("models");
  // visibility 列仅 admin 可见;普通用户模型恒 private,不显示该列。
  const showVisibility = isAdmin;
  const groupedReorderable = isAdmin && Boolean(groupedReorderAction);
  const reorderable = Boolean(reorderAction || groupedReorderAction);
  const [addOpen, setAddOpen] = useState(Boolean(createInitial));
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const [routeAddModelId, setRouteAddModelId] = useState<string | null>(null);
  const [routeEditId, setRouteEditId] = useState<string | null>(null);
  const [routeDeleteId, setRouteDeleteId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // 乐观顺序:分组拖动只重排所属可见性分组,revalidate 后自动对齐真实数据。
  const [optimisticModels, setOptimisticModels] = useOptimistic(
    models,
    (state, update: { orderedIds: string[]; visibility?: ModelVisibility }) => {
      const map = new Map(state.map((m) => [m.id, m]));
      const ordered = update.orderedIds
        .map((id) => map.get(id))
        .filter((m): m is ModelItem => Boolean(m));
      if (!update.visibility) return ordered;
      const other = state.filter(
        (model) => (model.visibility === "public" ? "public" : "private") !== update.visibility,
      );
      return update.visibility === "private" ? [...ordered, ...other] : [...other, ...ordered];
    },
  );

  // PointerSensor 服鼠标/触控；KeyboardSensor 让键盘用户聚焦拖动手柄后用
  // Space 拾起、方向键移动、再次 Space 落下，补齐排序的可达性路径。
  const sensors = useSensors(
    useSensor(KeyboardSensor),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const editing = optimisticModels.find((m) => m.id === editId) ?? null;
  const deleting = optimisticModels.find((m) => m.id === deleteId) ?? null;
  const publishing = optimisticModels.find((m) => m.id === publishId) ?? null;
  const routeEditing = routes?.find((r) => r.id === routeEditId) ?? null;
  const routeDeleting = routes?.find((r) => r.id === routeDeleteId) ?? null;
  const routeAddModel = optimisticModels.find((m) => m.id === routeAddModelId) ?? null;
  const routeEditingModel = optimisticModels.find((m) => m.id === routeEditing?.modelId) ?? null;

  // 列数:基础列(showVisibility ? 5 : 4,对外名/显示名合一 + 去路由数列)+ 拖动手柄列(可拖动时 +1)。空态 / 展开行 colSpan 用此值。
  const colCount = (showVisibility ? 5 : 4) + (reorderable ? 1 : 0);

  function handleDragEnd(
    event: DragEndEvent,
    groupModels: ModelItem[],
    visibility?: ModelVisibility,
  ) {
    if (visibility ? !groupedReorderAction : !reorderAction) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = groupModels.map((m) => m.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    // async transition:await server action 期间 transition 保持 pending,useOptimistic
    // 乐观态持续到 revalidate 送回真实数据(顺序一致),避免「新序→旧序→新序」闪动。
    // 与本仓所有 startTransition(async () => await ...Action()) 约定一致。
    startTransition(async () => {
      setOptimisticModels({ orderedIds: newIds, visibility });
      if (visibility) await groupedReorderAction!(visibility, newIds);
      else await reorderAction!(newIds);
    });
  }

  function renderTable(groupModels: ModelItem[], visibility?: ModelVisibility) {
    const tableReorderable = Boolean(visibility ? groupedReorderAction : reorderAction);
    const table = (
      <div className="rounded-lg border border-morning-mist  bg-nebula-white  overflow-x-auto transition-colors duration-150">
        <table className="w-full min-w-[680px] text-ui-body border-collapse text-left">
          <thead className="bg-neutral-50/70  border-b border-morning-mist  text-neutral-500  font-mono text-ui-caption uppercase">
            <tr>
              {reorderable && <th className="p-3.5 w-8" />}
              <th className="p-3.5 font-medium">{t("colExternalName")}</th>
              <th className="p-3.5 font-medium">{t("catalogLabel")}</th>
              {showVisibility && <th className="p-3.5 font-medium">{t("colVisibility")}</th>}
              <th className="p-3.5 font-medium">{t("colStatus")}</th>
              <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 ">
            {groupModels.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-10 text-center text-ui-caption text-neutral-500">
                  {visibility ? t("emptyGroup") : t("emptyState")}
                </td>
              </tr>
            ) : tableReorderable ? (
              <SortableContext items={groupModels.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                {groupModels.map((m) => {
                  const modelRoutes = routes?.filter((r) => r.modelId === m.id) ?? [];
                  const expanded = expandedModel === m.id;
                  return (
                    <SortableModelRow
                      key={m.id}
                      model={m}
                      catalogOption={catalog.find((opt) => opt.id === m.catalogId)}
                      routes={modelRoutes}
                      hasVisibility={showVisibility}
                      visibilityAction={visibilityActions?.[m.id]}
                      routeCount={modelRoutes.length}
                      expanded={expanded}
                      colSpan={colCount}
                      onToggleExpand={() => setExpandedModel(expanded ? null : m.id)}
                      onPublish={() => setPublishId(m.id)}
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
              groupModels.map((m) => {
                const modelRoutes = routes?.filter((r) => r.modelId === m.id) ?? [];
                const expanded = expandedModel === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr className="hover:bg-neutral-50/50  transition-colors duration-150">
                      <ModelRowCells
                        model={m}
                        catalogOption={catalog.find((opt) => opt.id === m.catalogId)}
                        hasVisibility={showVisibility}
                        visibilityAction={visibilityActions?.[m.id]}
                        routeCount={modelRoutes.length}
                        expanded={expanded}
                        onToggleExpand={() => setExpandedModel(expanded ? null : m.id)}
                        onPublish={() => setPublishId(m.id)}
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
    return tableReorderable ? (
      <DndContext
        id={visibility ? `models-${visibility}-sortable` : "models-sortable"}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => handleDragEnd(event, groupModels, visibility)}
      >
        {table}
      </DndContext>
    ) : table;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-ui-caption font-mono text-neutral-500">
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

      {groupedReorderable ? (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-ui-body font-semibold text-neutral-800 ">
              {t("privateGroup")}
            </h2>
            {renderTable(optimisticModels.filter((model) => model.visibility !== "public"), "private")}
          </section>
          <section className="space-y-2">
            <h2 className="text-ui-body font-semibold text-neutral-800 ">
              {t("publicGroup")}
            </h2>
            {renderTable(optimisticModels.filter((model) => model.visibility === "public"), "public")}
          </section>
        </div>
      ) : (
        renderTable(optimisticModels)
      )}

      <ModelFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        isAdmin={isAdmin}
        action={createAction}
        initial={createInitial}
        catalog={catalog}
      />
      {editing && (
        <ModelFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          isAdmin={isAdmin}
          visibilityManagedInList={Boolean(visibilityActions)}
          action={updateActions[editing.id]}
          initial={{
            name: editing.name,
            displayName: editing.displayName,
            catalogId: editing.catalogId,
            visibility: editing.visibility as "public" | "private",
            systemPrompt: editing.systemPrompt ?? "",
            description: editing.description ?? "",
          } satisfies ModelInitial}
          catalog={catalog}
        />
      )}

      {routeAddModelId && routeAddModel && createRouteActions?.[routeAddModelId] && (
        <RouteFormDialog
          open={true}
          onClose={() => setRouteAddModelId(null)}
          mode="add"
          action={createRouteActions[routeAddModelId]}
          providers={providers ?? []}
          modelType={routeAddModel.modelType}
          fetchModelsAction={fetchModelsAction}
          modelName={routeAddModel.name}
        />
      )}
      {routeEditing && routeEditingModel && updateRouteActions?.[routeEditing.id] && (
        <RouteFormDialog
          open={true}
          onClose={() => setRouteEditId(null)}
          mode="edit"
          action={updateRouteActions[routeEditing.id]}
          providers={providers ?? []}
          modelType={routeEditingModel.modelType}
          fetchModelsAction={fetchModelsAction}
          initial={{
            providerId: routeEditing.providerId,
            upstreamModelName: routeEditing.upstreamModelName,
            apiFormat: routeEditing.apiFormat,
            priority: routeEditing.priority,
            weight: routeEditing.weight,
            supportsTools: routeEditing.supportsTools,
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteId(null)}
          title={t("deleteModelTitle")}
          message={
            <div className="flex gap-3 text-ui-body text-neutral-600  mt-2">
              <ShieldAlert className="w-5 h-5 text-danger shrink-0" />
              <div>
                {t("deleteModelConfirm", { name: deleting.name })}
                <p className="text-ui-caption text-neutral-500 mt-1 leading-normal">
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

      {publishing && visibilityActions?.[publishing.id] && (
        <ConfirmDialog
          open={true}
          onClose={() => setPublishId(null)}
          title={t("publishModelTitle")}
          message={t("publishModelConfirm", { name: publishing.name })}
          confirmLabel={t("confirmPublish")}
          danger={false}
          action={visibilityActions[publishing.id].publish}
        />
      )}

      {routeDeleting && deleteRouteActions?.[routeDeleting.id] && (
        <ConfirmDialog
          open={true}
          onClose={() => setRouteDeleteId(null)}
          title={t("deleteRouteTitle")}
          message={
            <div className="flex gap-3 text-ui-body text-neutral-600  mt-2">
              <ShieldAlert className="w-5 h-5 text-danger shrink-0" />
              <div>
                {t("deleteRouteConfirm", { name: routeDeleting.providerName })}
                <p className="text-ui-caption text-neutral-500 mt-1 leading-normal font-mono">
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

/** 模型主行的内容单元格。拖动手柄由外层行组件提供。 */
function ModelRowCells({
  model,
  catalogOption,
  hasVisibility,
  visibilityAction,
  routeCount,
  expanded,
  onToggleExpand,
  onPublish,
  onEdit,
  onDelete,
  toggleAction,
}: {
  model: ModelItem;
  catalogOption?: ModelCatalogOption;
  hasVisibility: boolean;
  visibilityAction?: ModelVisibilityActions;
  routeCount: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onPublish: () => void;
  onEdit: () => void;
  onDelete: () => void;
  toggleAction: FormDataSerializableAction;
}) {
  const t = useTranslations("models");
  return (
    <>
      <td className="p-3.5">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-ui-caption font-semibold text-neutral-800  max-w-[16rem] truncate" title={model.name}>
            {model.name}
          </span>
          {model.displayName && model.displayName !== model.name ? (
            <span className="text-ui-caption text-neutral-500  max-w-[16rem] truncate" title={model.displayName}>
              {model.displayName}
            </span>
          ) : null}
        </div>
      </td>
      <td className="p-3.5 text-ui-caption">
        {catalogOption ? (
          <Popover
            openOnHover
            side="bottom"
            panelClassName="p-3"
            trigger={
              <Badge variant="primary" className="cursor-default max-w-[10rem] min-w-0" title={model.catalogName}>
                <span className="truncate">{model.catalogName}</span>
              </Badge>
            }
          >
            <CatalogDetailCard catalog={catalogOption} />
          </Popover>
        ) : (
          <span className="text-neutral-500 ">{model.catalogName}</span>
        )}
      </td>
      {hasVisibility && (
        <td className="p-3.5 text-ui-caption">
          {visibilityAction ? (
            model.visibility === "public" ? (
              <form action={visibilityAction.makePrivate} className="inline-flex rounded-md border border-morning-mist  overflow-hidden" aria-label={t("visibilityLabel")}>
                <button
                  type="submit"
                  className="px-2.5 py-1.5 text-ui-caption font-medium text-neutral-500 hover:bg-neutral-100   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue"
                  title={t("makePrivate")}
                >
                  {t("visibilityPrivate")}
                </button>
                <span className="px-2.5 py-1.5 text-ui-caption font-semibold bg-sora-blue text-white" aria-current="true">
                  {t("visibilityPublic")}
                </span>
              </form>
            ) : (
              <div role="group" className="inline-flex rounded-md border border-morning-mist  overflow-hidden" aria-label={t("visibilityLabel")}>
                <span className="px-2.5 py-1.5 text-ui-caption font-semibold bg-neutral-800 text-white  " aria-current="true">
                  {t("visibilityPrivate")}
                </span>
                <button
                  type="button"
                  onClick={onPublish}
                  className="px-2.5 py-1.5 text-ui-caption font-medium text-neutral-500 hover:bg-sora-blue/10 hover:text-sora-blue   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue"
                  title={t("publishModel")}
                >
                  {t("visibilityPublic")}
                </button>
              </div>
            )
          ) : (
            <Badge variant={model.visibility === "public" ? "success" : "warning"}>
              {model.visibility === "public" ? t("visibilityPublic") : t("visibilityPrivate")}
            </Badge>
          )}
        </td>
      )}
      <td className="p-3.5">
        <form action={toggleAction} className="inline-block">
          <button
            type="submit"
            role="switch"
            aria-checked={model.enabled}
            aria-label={model.enabled ? t("disable") : t("enable")}
            title={model.enabled ? t("disable") : t("enable")}
            className={clsx(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40",
              model.enabled ? "bg-sora-blue " : "bg-neutral-300 "
            )}
          >
            <span
              className={clsx(
                "pointer-events-none absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-transform duration-200",
                model.enabled ? "translate-x-[18px]" : "translate-x-[2px]"
              )}
            />
          </button>
        </form>
      </td>
      <td className="p-3.5 text-right space-x-1 whitespace-nowrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleExpand}
          className={clsx(
            expanded
              ? "text-neutral-800  bg-neutral-100 "
              : "text-sora-blue hover:bg-sora-blue/10 "
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
          className="text-neutral-700 hover:text-neutral-900  "
          title={t("edit")}
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span>{t("edit")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-danger hover:bg-red-50  hover:text-danger-hover"
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
    <tr className="bg-neutral-50/40 ">
      <td colSpan={colSpan} className="p-4 border-t border-neutral-100 ">
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
  catalogOption,
  routes,
  hasVisibility,
  visibilityAction,
  routeCount,
  expanded,
  colSpan,
  onToggleExpand,
  onPublish,
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
  catalogOption?: ModelCatalogOption;
  routes: RouteItem[];
  hasVisibility: boolean;
  visibilityAction?: ModelVisibilityActions;
  routeCount: number;
  expanded: boolean;
  colSpan: number;
  onToggleExpand: () => void;
  onPublish: () => void;
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
        className="hover:bg-neutral-50/50  transition-colors duration-150"
      >
        <td className="p-3.5 text-center align-middle">
          <button
            type="button"
            aria-label={t("dragHandle")}
            className="cursor-grab active:cursor-grabbing inline-flex items-center justify-center text-neutral-500 hover:text-neutral-700  "
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        </td>
        <ModelRowCells
          model={model}
          catalogOption={catalogOption}
          hasVisibility={hasVisibility}
          visibilityAction={visibilityAction}
          routeCount={routeCount}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          onPublish={onPublish}
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
    <div className="space-y-3 p-4 rounded-lg bg-neutral-50/50  border border-neutral-200/65 ">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-ui-caption font-medium text-neutral-500 ">
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
        <p className="text-ui-caption text-neutral-500 py-3 text-center border border-dashed border-neutral-200  rounded">
          {t("noRoutesHint")}
        </p>
      ) : (
        <div className="rounded-md border border-morning-mist  overflow-x-auto bg-nebula-white ">
          <table className="w-full min-w-[680px] text-ui-caption text-left">
            <thead className="bg-neutral-50  text-neutral-500  font-mono text-ui-caption uppercase border-b border-morning-mist ">
              <tr>
                <th className="p-2.5 font-medium">{t("colUpstreamProvider")}</th>
                <th className="p-2.5 font-medium">{t("colUpstreamModelName")}</th>
                <th className="p-2.5 font-medium">{t("colProtocol")}</th>
                <th className="p-2.5 font-medium text-center">{t("colPriority")}</th>
                <th className="p-2.5 font-medium text-center">{t("colWeight")}</th>
                <th className="p-2.5 font-medium">{t("colStatus")}</th>
                <th className="p-2.5 font-medium text-right">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 ">
              {routes.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-neutral-50/50  transition-colors"
                >
                  <td className="p-2.5 font-medium text-neutral-800 ">{r.providerName}</td>
                  <td className="p-2.5 font-mono text-ui-caption text-neutral-500 ">
                    <span className="inline-flex items-center gap-1.5">
                      {r.upstreamModelName}
                      {r.supportsTools && (
                        <Badge>{t("supportsToolsBadge")}</Badge>
                      )}
                      {syncMap[r.id] === "synced" && (
                        <Badge variant="success">{t("syncSynced")}</Badge>
                      )}
                      {syncMap[r.id] === "local-only" && (
                        <Badge variant="danger" title={t("syncLocalOnlyHint")}>{t("syncLocalOnly")}</Badge>
                      )}
                    </span>
                  </td>
                  <td className="p-2.5 font-mono text-ui-caption text-neutral-500 ">
                    {r.apiFormat}
                  </td>
                  <td className="p-2.5 text-center font-mono text-ui-caption font-semibold">{r.priority}</td>
                  <td className="p-2.5 text-center font-mono text-ui-caption font-semibold">{r.weight}</td>
                  <td className="p-2.5">
                    <StatusDot
                      enabled={r.enabled && r.providerEnabled}
                      enabledLabel={t("statusEnabled")}
                      disabledLabel={r.enabled ? t("providerDisabled") : t("statusDisabled")}
                    />
                  </td>
                  <td className="p-2.5 text-right space-x-1 whitespace-nowrap">
                    {testActions?.[r.id] && (
                      <RouteTestButton action={testActions[r.id]} id={r.id} />
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onEdit(r.id)}
                      className="text-neutral-700 hover:text-neutral-900  "
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
                              ? "text-warning  hover:bg-warning/10 "
                              : "text-success  hover:bg-success/10 "
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
                      className="text-danger hover:bg-red-50  hover:text-danger-hover"
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
      <p className="text-ui-caption text-neutral-500">
        {t("priorityWeightTip")}
      </p>
    </div>
  );
}
