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
  Eye,
  Monitor,
  Smartphone,
  Plus,
  Edit2,
  Play,
  Square,
  Trash2,
  ShieldAlert,
  Lock,
  GripVertical,
} from "lucide-react";
import { clsx } from "clsx";
import RenderStyleFormDialog, { type RenderStyle } from "./RenderStyleFormDialog";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import StatusDot from "@/shared/ui/StatusDot";
import { Markdown } from "@/shared/components/markdown/Markdown";

const PREVIEW_MARKDOWN = `## 星枢输出预览

这是一段包含 **重点**、列表与代码的真实 Markdown 示例：

- 清晰的信息层级
- 稳定的长文阅读节奏

\`\`\`ts
const release = "atomic";
\`\`\``;

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
  const [previewId, setPreviewId] = useState<string | null>(styles[0]?.id ?? null);
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const [pending, startTransition] = useTransition();

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
  const previewing = optimisticStyles.find((s) => s.id === previewId) ?? optimisticStyles[0] ?? null;

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
      setOptimisticStyles(newIds);
      await performAction(() => reorderAction(newIds)).catch(() => undefined);
    });
  }

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
    reorder(newIds);
  }

  function move(id: string, offset: -1 | 1) {
    const ids = optimisticStyles.map((style) => style.id);
    const from = ids.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    reorder(arrayMove(ids, from, to));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-ui-caption font-mono text-neutral-400 ">
          {t("configuredCount", { count: optimisticStyles.length })}
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

      {previewing && (
        <section className="rounded-lg border border-morning-mist bg-neutral-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-ui-caption font-medium text-neutral-500">{t("previewTitle")}</p>
              <h3 className="mt-1 text-ui-body font-semibold text-space-ink">{previewing.name}</h3>
            </div>
            <div className="inline-flex rounded-md border border-morning-mist bg-nebula-white p-1" role="group" aria-label={t("previewViewport")}>
              <button type="button" onClick={() => setPreviewWidth("desktop")} aria-pressed={previewWidth === "desktop"} className={clsx("touch-target inline-flex items-center gap-1 rounded px-2 text-ui-caption", previewWidth === "desktop" && "bg-neutral-100 text-space-ink")}>
                <Monitor className="h-3.5 w-3.5" />{t("desktopPreview")}
              </button>
              <button type="button" onClick={() => setPreviewWidth("mobile")} aria-pressed={previewWidth === "mobile"} className={clsx("touch-target inline-flex items-center gap-1 rounded px-2 text-ui-caption", previewWidth === "mobile" && "bg-neutral-100 text-space-ink")}>
                <Smartphone className="h-3.5 w-3.5" />{t("mobilePreview")}
              </button>
            </div>
          </div>
          <div className={clsx("mx-auto rounded-md border border-morning-mist bg-nebula-white p-5 transition-[max-width] duration-150", previewWidth === "mobile" ? "max-w-[390px]" : "max-w-none")}>
            <style>{previewing.css}</style>
            <div className={`rs-${previewing.cssClass}`}>
              <Markdown content={PREVIEW_MARKDOWN} isStreaming={false} renderer={previewing.renderer} renderStyleClass={previewing.cssClass} />
            </div>
          </div>
          {previewing.renderer === "custom" && (
            <p className="mt-2 flex items-center gap-1.5 text-ui-caption text-warning">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              {t("previewTrustWarning")}
            </p>
          )}
        </section>
      )}

      <DndContext id="render-styles-sortable" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto rounded-lg border border-morning-mist bg-nebula-white transition-colors duration-150">
          <table className="w-full min-w-[780px] text-ui-body border-collapse text-left">
            <thead className="bg-neutral-50/70  border-b border-morning-mist  text-neutral-500  font-mono text-ui-caption uppercase">
              <tr>
                <th className="p-3.5 w-8" />
                <th className="p-3.5 font-medium">{t("colName")}</th>
                <th className="p-3.5 font-medium">{t("colCssClass")}</th>
                <th className="p-3.5 font-medium">{t("colDesc")}</th>
                <th className="p-3.5 font-medium">{t("colStatus")}</th>
                <th className="p-3.5 font-medium text-right">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 ">
              {optimisticStyles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-ui-caption text-neutral-400 ">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                <SortableContext items={optimisticStyles.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {optimisticStyles.map((s, index) => (
                    <SortableRenderStyleRow
                      key={s.id}
                      style={s}
                      onEdit={setEditId}
                      onDelete={setDeleteId}
                      onToggle={() => runAction(toggleActions[s.id])}
                      onPreview={setPreviewId}
                      onMove={move}
                      canMoveUp={index > 0}
                      canMoveDown={index < optimisticStyles.length - 1}
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
      <RenderStyleFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
        onSuccess={() => setFeedback("success")}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <RenderStyleFormDialog
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
                <p className="text-ui-caption text-neutral-400  mt-1 leading-normal">
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

/**
 * 可拖动行:useSortable 必须在独立组件内调用(不能在 .map 回调里)。手柄绑 listeners/attributes。
 * 内置样式(builtin=paper)同样参与拖动——它只锁 cssClass 不可改 / 不可删,顺序可由用户重排。
 */
function SortableRenderStyleRow({
  style,
  onEdit,
  onDelete,
  onToggle,
  onPreview,
  onMove,
  canMoveUp,
  canMoveDown,
  pending,
}: {
  style: RenderStyle;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: () => void;
  onPreview: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pending: boolean;
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
          <button type="button" disabled={pending || !canMoveUp} onClick={() => onMove(style.id, -1)} aria-label={t("moveUp")} className="touch-target inline-flex items-center justify-center text-neutral-500 disabled:text-neutral-300">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={pending || !canMoveDown} onClick={() => onMove(style.id, 1)} aria-label={t("moveDown")} className="touch-target inline-flex items-center justify-center text-neutral-500 disabled:text-neutral-300">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </span>
      </td>
      <td className="p-3.5 font-semibold text-neutral-800 ">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onPreview(style.id)} className="inline-flex items-center gap-1.5 rounded text-left hover:text-sora-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue/40">
            {style.name}
            <Eye className="h-3.5 w-3.5 text-neutral-400" aria-hidden="true" />
          </button>
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
      <td className="p-3.5 text-ui-caption text-neutral-500  max-w-[240px] truncate" title={style.description ?? ""}>
        {style.description || <span className="text-neutral-400 ">-</span>}
      </td>
      <td className="p-3.5">
        <StatusDot enabled={style.enabled} label={style.enabled ? undefined : t("disabled")} />
      </td>
      <td className="p-3.5 text-right space-x-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(style.id)}
          disabled={pending}
          className="text-neutral-700 hover:text-neutral-900  "
          title={t("edit")}
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span>{t("edit")}</span>
        </Button>

        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggle}
            disabled={pending}
            className={clsx(
              style.enabled
                ? "text-warning  hover:bg-warning/10 "
                : "text-success  hover:bg-success/10 "
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

        {style.builtin ? (
          <Button
            variant="ghost"
            size="sm"
            disabled
            className="text-neutral-300  cursor-not-allowed"
            title={t("builtinNoDelete")}
          >
            <Lock className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(style.id)}
            disabled={pending}
            className="text-danger hover:bg-red-50  hover:text-danger-hover"
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
