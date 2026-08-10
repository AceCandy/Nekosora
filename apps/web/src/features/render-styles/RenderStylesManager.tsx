"use client";
import { useState, useOptimistic, useTransition } from "react";
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
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert, Lock, GripVertical } from "lucide-react";
import { clsx } from "clsx";
import RenderStyleFormDialog, { type RenderStyle } from "./RenderStyleFormDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";

interface RenderStylesManagerProps {
  styles: RenderStyle[];
  createAction: (formData: FormData) => void | Promise<void>;
  updateActions: Record<string, (formData: FormData) => void | Promise<void>>;
  toggleActions: Record<string, () => void | Promise<void>>;
  deleteActions: Record<string, () => void | Promise<void>>;
  reorderAction: (orderedIds: string[]) => void | Promise<void>;
}

export default function RenderStylesManager({
  styles,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
  reorderAction,
}: RenderStylesManagerProps) {
  const t = useTranslations("admin.renderStyles");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // 乐观顺序:拖动时立即按新 id 顺序重排渲染,revalidate 后自动对齐真实数据(顺序一致)。
  const [optimisticStyles, setOptimisticStyles] = useOptimistic(
    styles,
    (state, orderedIds: string[]) => {
      const map = new Map(state.map((s) => [s.id, s]));
      return orderedIds
        .map((id) => map.get(id))
        .filter((s): s is RenderStyle => Boolean(s));
    },
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const editing = optimisticStyles.find((s) => s.id === editId) ?? null;
  const deleting = optimisticStyles.find((s) => s.id === deleteId) ?? null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = optimisticStyles.map((s) => s.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    // async transition:await server action 期间 transition 保持 pending,useOptimistic
    // 乐观态持续到 revalidate 送回真实数据(顺序一致),避免「新序→旧序→新序」闪动。
    // 与本仓所有 startTransition(async () => await ...Action()) 约定一致。
    startTransition(async () => {
      setOptimisticStyles(newIds);
      await reorderAction(newIds);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-ui-caption font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          {t("configuredCount", { count: optimisticStyles.length })}
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
          <table className="w-full text-ui-body border-collapse text-left">
            <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-ui-caption uppercase">
              <tr>
                <th className="p-3.5 w-8" />
                <th className="p-3.5 font-medium">{t("colName")}</th>
                <th className="p-3.5 font-medium">{t("colCssClass")}</th>
                <th className="p-3.5 font-medium">{t("colDesc")}</th>
                <th className="p-3.5 font-medium">{t("colStatus")}</th>
                <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
              {optimisticStyles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-ui-caption text-neutral-400 dark:text-neutral-500">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                <SortableContext items={optimisticStyles.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {optimisticStyles.map((s) => (
                    <SortableRenderStyleRow
                      key={s.id}
                      style={s}
                      onEdit={setEditId}
                      onDelete={setDeleteId}
                      toggleAction={toggleActions[s.id]}
                    />
                  ))}
                </SortableContext>
              )}
            </tbody>
          </table>
        </div>
      </DndContext>

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
            <div className="flex gap-3 text-ui-body text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                {t("deleteConfirm", { name: deleting.name })}
                <p className="text-ui-caption text-neutral-400 dark:text-neutral-500 mt-1 leading-normal">
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

/**
 * 可拖动行:useSortable 必须在独立组件内调用(不能在 .map 回调里)。手柄绑 listeners/attributes。
 * 内置样式(builtin=paper)同样参与拖动——它只锁 cssClass 不可改 / 不可删,顺序可由用户重排。
 */
function SortableRenderStyleRow({
  style,
  onEdit,
  onDelete,
  toggleAction,
}: {
  style: RenderStyle;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  toggleAction: () => void | Promise<void>;
}) {
  const t = useTranslations("admin.renderStyles");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: style.id,
  });
  const styleProp = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { opacity: 0.4 } : {}),
  };
  return (
    <tr
      ref={setNodeRef}
      style={styleProp}
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
      <td className="p-3.5 font-semibold text-neutral-800 dark:text-white">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span>{style.name}</span>
          {style.builtin && (
            <Lock className="w-3 h-3 text-neutral-400" aria-label={t("builtin")} />
          )}
          {style.renderer === "custom" && (
            <Badge
              variant="warning"
              className="shrink-0 gap-1"
              title={t("customRendererBadgeTitle")}
            >
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              <span className="text-space-ink">{t("customRendererBadge")}</span>
            </Badge>
          )}
        </span>
      </td>
      <td className="p-3.5 font-mono text-ui-caption">
        <Badge variant="neutral" className="font-mono text-ui-caption py-0.5">
          {style.cssClass}
        </Badge>
      </td>
      <td className="p-3.5 text-ui-caption text-neutral-500 dark:text-neutral-400 max-w-[240px] truncate" title={style.description ?? ""}>
        {style.description || <span className="text-neutral-400 dark:text-neutral-600">-</span>}
      </td>
      <td className="p-3.5">
        <StatusDot enabled={style.enabled} label={style.enabled ? undefined : t("disabled")} />
      </td>
      <td className="p-3.5 text-right space-x-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(style.id)}
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
              style.enabled
                ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
            )}
            title={style.enabled ? t("disable") : t("enable")}
          >
            {style.enabled ? (
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

        {style.builtin ? (
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
            onClick={() => onDelete(style.id)}
            className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
            title={t("delete")}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("delete")}</span>
          </Button>
        )}
      </td>
    </tr>
  );
}
