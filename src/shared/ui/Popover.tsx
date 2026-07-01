"use client";

import React from "react";
import { clsx } from "clsx";

export interface PopoverProps {
  /** 受控显隐状态：由外部持有，内部只负责渲染与 click-outside。 */
  open: boolean;
  /** 关闭回调（点击遮罩时触发）。 */
  onClose: () => void;
  /** 触发器：由外部渲染并自行控制 open（本组件不做事件绑定）。 */
  trigger: React.ReactNode;
  /** 浮层内容。 */
  children: React.ReactNode;
  /** 浮层水平对齐：left=左对齐触发器（默认），right=右对齐（动作菜单常用）。 */
  align?: "left" | "right";
  /** 浮层面板额外 class（宽度/内边距等由调用方决定）。 */
  panelClassName?: string;
  /** 浮层面板 z-index 层级（默认 z-30，遮罩 z-20）。 */
  panelZ?: string;
}

/**
 * Popover —— 域无关的受控浮层壳。
 *
 * 只负责：触发器占位 + click-outside 遮罩 + 绝对定位面板容器。
 * 不含任何选择/动作语义——listbox 选择器与动作菜单各自在外层组合。
 *
 * 与 shared/ui 约定一致：原生 + inline Tailwind，不引入第三方浮层库。
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = "left",
  panelClassName,
  panelZ = "z-30",
}: PopoverProps) {
  return (
    <div className="relative">
      {trigger}
      {open && (
        <>
          {/* click-outside catcher：覆盖全屏，点击即关闭 */}
          <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />
          <div
            className={clsx(
              "absolute mt-1 rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1",
              align === "left" ? "left-0" : "right-0",
              panelZ,
              panelClassName,
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

Popover.displayName = "Popover";
export default Popover;
