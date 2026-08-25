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
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Edit2,
  Trash2,
  ShieldAlert,
  GripVertical,
} from "lucide-react";
import OutputModeFormDialog, { type OutputMode } from "./OutputModeFormDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusSwitch from "@/shared/ui/StatusSwitch";

interface OutputModesManagerProps {
  modes: OutputMode[];
  createAction: (formData: FormData) => void | Promise<void>;
  updateActions: Record<string, (formData: FormData) => void | Promise<void>>;
  toggleActions: Record<string, () => void | Promise<void>>;
  deleteActions: Record<string, () => void | Promise<void>>;
  reorderAction: (orderedIds: string[]) => void | Promise<void>;
}

export default function OutputModesManager({
  modes,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
  reorderAction,
}: OutputModesManagerProps) {
  const t = useTranslations("admin.outputModes");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const [pending, startTransition] = useTransition();

  // 乐观顺序:拖动时立即按新 id 顺序重排渲染,revalidate 后自动对齐真实数据(顺序一致)。
  const [optimisticModes, setOptimisticModes] = useOptimistic(
    modes,
    (state, orderedIds: string[]) => {
      const map = new Map(state.map((m) => [m.id, m]));
      return orderedIds
        .map((id) => map.get(id))
        .filter((m): m is OutputMode => Boolean(m));
    },
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const editing = optimisticModes.find((m) => m.id === editId) ?? null;
  const deleting = optimisticModes.find((m) => m.id === deleteId) ?? null;

  async function performAction(action: () => void | Promise<void>) {
    setFeedback("idle");
    try {
      await action();
      setFeedback("success");
    } catch (error) {
      setFeedback("error");
      throw error;
    }
  }

  function runAction(action: () => void | Promise<void>) {
    startTransition(async () => {
      await performAction(action).catch(() => undefined);
    });
  }

  function reorder(newIds: string[]) {
    if (pending) return;
    startTransition(async () => {
      setOptimisticModes(newIds);
      await performAction(() => reorderAction(newIds)).catch(() => undefined);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = optimisticModes.map((m) => m.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    // async transition:await server action 期间 transition 保持 pending,useOptimistic
    // 乐观态持续到 revalidate 送回真实数据(顺序一致),避免「新序→旧序→新序」闪动。
    // 与本仓所有 startTransition(async () => await ...Action()) 约定一致。
    reorder(newIds);
  }

  function move(id: string, offset: -1 | 1) {
    const ids = optimisticModes.map((mode) => mode.id);
    const from = ids.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    reorder(arrayMove(ids, from, to));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-ui-caption font-mono text-ink-tertiary ">
          {t("configuredCount", { count: optimisticModes.length })}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          disabled={pending}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t("addBtn")}</span>
        </Button>
      </div>

      <div className="min-h-5 text-ui-body" aria-live="polite">
        {pending && <p className="text-neutral-600">{t("saving")}</p>}
        {!pending && feedback === "success" && <p role="status" className="text-success">{t("saved")}</p>}
        {!pending && feedback === "error" && <p role="alert" className="text-danger">{t("saveFailed")}</p>}
      </div>

      <DndContext id="output-modes-sortable" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto rounded-lg border border-morning-mist bg-nebula-white transition-colors duration-150">
          <table className="w-full min-w-[760px] text-ui-body border-collapse text-left">
            <thead className="bg-neutral-50/70  border-b border-morning-mist  text-neutral-500  font-mono text-ui-caption uppercase">
              <tr>
                <th className="p-3.5 w-8" />
                <th className="p-3.5 font-medium">{t("colName")}</th>
                <th className="p-3.5 font-medium">{t("colIcon")}</th>
                <th className="p-3.5 font-medium">{t("colDesc")}</th>
                <th className="p-3.5 font-medium">{t("colStatus")}</th>
                <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 ">
              {optimisticModes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-ui-caption text-ink-tertiary ">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                <SortableContext items={optimisticModes.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                  {optimisticModes.map((m, index) => (
                    <SortableOutputModeRow
                      key={m.id}
                      mode={m}
                      onEdit={setEditId}
                      onDelete={setDeleteId}
                      onToggle={() => runAction(toggleActions[m.id])}
                      onMove={move}
                      canMoveUp={index > 0}
                      canMoveDown={index < optimisticModes.length - 1}
                      pending={pending}
                    />
                  ))}
                </SortableContext>
              )}
            </tbody>
          </table>
        </div>
      </DndContext>

      {/* 新增弹窗 */}
      <OutputModeFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
        onSuccess={() => setFeedback("success")}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <OutputModeFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          action={updateActions[editing.id]}
          onSuccess={() => setFeedback("success")}
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
            <div className="flex gap-3 text-ui-body text-neutral-600  mt-2">
              <ShieldAlert className="w-5 h-5 text-danger shrink-0" />
              <div>
                {t("deleteConfirm", { name: deleting.name })}
                <p className="text-ui-caption text-ink-tertiary  mt-1 leading-normal">
                  {t("deleteWarning")}
                </p>
              </div>
            </div>
          }
          confirmLabel={t("deleteButton")}
          danger
          onConfirm={() => performAction(deleteActions[deleting.id])}
          errorMessage={t("saveFailed")}
        />
      )}
    </div>
  );
}

/** 可拖动行:useSortable 必须在独立组件内调用(不能在 .map 回调里)。手柄绑 listeners/attributes。 */
function SortableOutputModeRow({
  mode,
  onEdit,
  onDelete,
  onToggle,
  onMove,
  canMoveUp,
  canMoveDown,
  pending,
}: {
  mode: OutputMode;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: () => void;
  onMove: (id: string, offset: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pending: boolean;
}) {
  const t = useTranslations("admin.outputModes");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mode.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { opacity: 0.4 } : {}),
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="hover:bg-neutral-50/50  transition-colors duration-150"
    >
      <td className="p-3.5 text-center align-middle">
        <span className="inline-flex items-center gap-0.5">
          <button
            type="button"
            disabled={pending}
            aria-label={t("dragHandle")}
            className="touch-target cursor-grab active:cursor-grabbing inline-flex items-center justify-center text-neutral-400 hover:text-neutral-600"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <button type="button" disabled={pending || !canMoveUp} onClick={() => onMove(mode.id, -1)} aria-label={t("moveUp")} className="touch-target inline-flex items-center justify-center text-neutral-500 disabled:text-neutral-300">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending || !canMoveDown} onClick={() => onMove(mode.id, 1)} aria-label={t("moveDown")} className="touch-target inline-flex items-center justify-center text-neutral-500 disabled:text-neutral-300">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </span>
      </td>
      <td className="p-3.5 font-semibold text-neutral-800 ">{mode.name}</td>
      <td className="p-3.5 font-mono text-ui-caption">
        {mode.icon ? (
          <Badge variant="neutral" className="font-mono text-ui-caption py-0.5">
            {mode.icon}
          </Badge>
        ) : (
          <span className="text-ink-tertiary ">-</span>
        )}
      </td>
      <td className="p-3.5 text-ui-caption text-neutral-500  max-w-[240px] truncate" title={mode.description ?? ""}>
        {mode.description || <span className="text-ink-tertiary ">-</span>}
      </td>
      <td className="p-3.5">
        <StatusSwitch
          checked={mode.enabled}
          label={mode.enabled ? t("disable") : t("enable")}
          onClick={onToggle}
          disabled={pending}
        />
      </td>
      <td className="p-3.5 text-right space-x-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(mode.id)}
          disabled={pending}
          className="text-neutral-700 hover:text-neutral-900  "
          title={t("edit")}
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span>{t("edit")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(mode.id)}
          disabled={pending}
          className="text-danger hover:bg-danger/[0.05] hover:text-danger-hover"
          title={t("delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t("delete")}</span>
        </Button>
      </td>
    </tr>
  );
}
