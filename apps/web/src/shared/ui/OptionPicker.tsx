"use client";

import React from "react";
import { clsx } from "clsx";
import { Popover, usePopoverClose } from "@/shared/ui/Popover";
import { Badge } from "@/shared/ui/Badge";

/** 单个可选项：id 是稳定标识，label 为主文本，其余为可选展示。 */
export interface OptionItem {
  id: string;
  label: string;
  description?: string | null;
  /** 行项右侧的副标签（如指令卡触发词 /foo、知识库文件数）。 */
  badge?: string;
  /** 副标签的有色徽章变体；不传时沿用灰色文字（指令卡/知识库的默认行为）。 */
  badgeVariant?: "primary" | "warning" | "success" | "danger" | "neutral";
}

export interface OptionPickerProps {
  /** 可选项列表。 */
  options: OptionItem[];
  /** 当前已选项 id 列表（单选时长度 0 或 1）。 */
  selectedIds: string[];
  /** 选择模式：multi=多选 toggle；single=单选，点击已选项触发 onClear。 */
  mode: "single" | "multi";
  /** 触发器按钮（由调用方渲染并持有 open 状态，本组件只占位）。 */
  trigger: React.ReactNode;
  /** 受控显隐。 */
  open: boolean;
  /** 关闭浮层。 */
  onClose: () => void;
  /** 切换某项：multi 下增删该项；single 下选中该项（如该项已选则不触发，改由 onClear 处理）。 */
  onToggle: (id: string) => void;
  /** 单选模式下，点击已选项时触发（用于清除选择）。multi 模式忽略。 */
  onClear?: () => void;
  /** 浮层面板宽度 class（默认 w-64）。 */
  panelClassName?: string;
  /** 触发器外层是否需要 relative 定位（默认 false，Popover 内部已提供 relative 容器）。 */
  ariaLabel?: string;
  /** 浮层垂直方向：bottom=下展（默认），top=上展。 */
  side?: "bottom" | "top";
  /** 浮层水平对齐：left=左对齐触发器（默认），right=右对齐。 */
  align?: "left" | "right";
  /** 是否改为 hover 打开（默认 false，沿用 click）。 */
  openOnHover?: boolean;
}

/**
 * 选项列表（在 Popover 的 Provider 树内渲染，故可消费 usePopoverClose）。
 * 单选模式下点击选项后立即请求浮层关闭。
 */
function OptionList({
  options,
  selectedIds,
  mode,
  onToggle,
  onClear,
  ariaLabel,
  closeOnSingleSelect,
}: {
  options: OptionItem[];
  selectedIds: string[];
  mode: "single" | "multi";
  onToggle: (id: string) => void;
  onClear?: () => void;
  ariaLabel?: string;
  closeOnSingleSelect: boolean;
}) {
  const requestClose = usePopoverClose();
  return (
    <>
      {options.map((opt) => {
        const isSelected = selectedIds.includes(opt.id);
        const handleClick = () => {
          if (mode === "single" && isSelected) {
            onClear?.();
          } else {
            onToggle(opt.id);
          }
          if (closeOnSingleSelect) requestClose();
        };
        return (
          <button
            key={opt.id}
            type="button"
            onClick={handleClick}
            aria-label={ariaLabel ? `${ariaLabel}: ${opt.label}` : opt.label}
            className={clsx(
              "w-full text-left rounded px-2 py-1.5 text-ui-caption transition-colors flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
              isSelected
                ? "bg-sora-blue/[0.06] text-sora-blue"
                : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
            )}
          >
            <span className={clsx("mt-0.5 shrink-0", isSelected ? "opacity-100" : "opacity-30")} aria-hidden="true">
              {isSelected ? "✓" : "○"}
            </span>
            <span className="min-w-0">
              {opt.badge && opt.badgeVariant ? (
                // 有色 Badge:label 与 Badge 同行(标签紧贴名字,与重生成列表一致)
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold truncate">{opt.label}</span>
                  <Badge variant={opt.badgeVariant} className="shrink-0 py-0 leading-none">{opt.badge}</Badge>
                </span>
              ) : (
                <>
                  <span className="font-semibold block truncate">{opt.label}</span>
                  {opt.badge && <span className="text-ui-caption text-neutral-400 font-mono">{opt.badge}</span>}
                </>
              )}
              {opt.description && (
                <span className="text-ui-caption text-neutral-400 block truncate">{opt.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </>
  );
}

/**
 * OptionPicker —— listbox 风格的选择器，基于 Popover。
 *
 * 收敛 chat 工具栏内多处雷同的「触发器 + click-outside + ✓/○ 项列表」结构。
 * - multi：多选，每项点击即 toggle，项左侧 ✓/○ 反映选中态。
 * - single：单选可清除，点击未选项 → 选中；点击已选项 → 触发 onClear。
 *
 * 触发器样式、项布局均沿用 chat 工具栏既有约定（sora-blue 高亮 + neutral 悬浮）。
 */
export function OptionPicker({
  options,
  selectedIds,
  mode,
  trigger,
  open,
  onClose,
  onToggle,
  onClear,
  panelClassName = "w-64 max-h-72 overflow-y-auto",
  ariaLabel,
  side,
  align,
  openOnHover,
}: OptionPickerProps) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={trigger}
      panelClassName={panelClassName}
      side={side}
      align={align}
      openOnHover={openOnHover}
    >
      <OptionList
        options={options}
        selectedIds={selectedIds}
        mode={mode}
        onToggle={onToggle}
        onClear={onClear}
        ariaLabel={ariaLabel}
        closeOnSingleSelect={mode === "single"}
      />
    </Popover>
  );
}

OptionPicker.displayName = "OptionPicker";
export default OptionPicker;
