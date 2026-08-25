import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowUpToLine, GripVertical } from "lucide-react";
import clsx from "clsx";

interface SortableControlsProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  dragLabel: string;
  moveToTopLabel: string;
  canMoveToTop: boolean;
  onMoveToTop: () => void;
  disabled?: boolean;
}

const CONTROL_CLASS = "touch-target inline-flex items-center justify-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue disabled:cursor-not-allowed disabled:text-neutral-300";

export function moveItemToTop<T>(items: T[], index: number): T[] {
  return index > 0 && index < items.length ? arrayMove(items, index, 0) : items;
}

export default function SortableControls({
  attributes,
  listeners,
  dragLabel,
  moveToTopLabel,
  canMoveToTop,
  onMoveToTop,
  disabled = false,
}: SortableControlsProps) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        {...attributes}
        {...listeners}
        type="button"
        disabled={disabled}
        aria-disabled={disabled || attributes["aria-disabled"]}
        aria-label={dragLabel}
        title={dragLabel}
        className={clsx(CONTROL_CLASS, "cursor-grab active:cursor-grabbing")}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={disabled || !canMoveToTop}
        aria-hidden={!canMoveToTop}
        aria-label={moveToTopLabel}
        title={canMoveToTop ? moveToTopLabel : undefined}
        tabIndex={canMoveToTop ? undefined : -1}
        onClick={onMoveToTop}
        className={clsx(CONTROL_CLASS, !canMoveToTop && "invisible")}
      >
        <ArrowUpToLine className="h-4 w-4" aria-hidden="true" />
      </button>
    </span>
  );
}
