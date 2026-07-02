"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
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
  /** 浮层垂直方向：bottom=下展（默认），top=上展（工具栏底部按钮常用）。 */
  side?: "bottom" | "top";
  /** 浮层面板额外 class（宽度/内边距等由调用方决定）。 */
  panelClassName?: string;
  /** 浮层面板 z-index 层级（默认 z-30，遮罩 z-20）。 */
  panelZ?: string;
  /**
   * 是否改为 hover 打开（默认 false）。
   * 开启后由内部 hovered state 控制：鼠标进入触发器/面板即展开，离开延迟 150ms 收起，
   * 不再渲染 click-outside 遮罩。供面板内子项通过 PopoverCloseContext 请求立即关闭。
   */
  openOnHover?: boolean;
}

/**
 * PopoverCloseContext —— 供面板内子组件（如 OptionPicker）请求立即关闭。
 * click 模式下转调 onClose；hover 模式下清空 hovered。
 */
const PopoverCloseContext = createContext<() => void>(() => {});
/** 读取当前 Popover 的关闭函数（用于面板内点击选项后立即收起）。 */
export const usePopoverClose = () => useContext(PopoverCloseContext);

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
  side = "bottom",
  panelClassName,
  panelZ = "z-30",
  openOnHover = false,
}: PopoverProps) {
  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const onEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(true);
  };
  const onLeave = () => {
    // 延迟收起,给鼠标从触发器移到面板留出过渡时间
    closeTimer.current = setTimeout(() => setHovered(false), 150);
  };

  const effectiveOpen = openOnHover ? hovered : open;
  const close = useCallback(() => {
    if (openOnHover) setHovered(false);
    else onClose();
  }, [openOnHover, onClose]);

  const ctx = close;

  return (
    <PopoverCloseContext.Provider value={ctx}>
      <div
        ref={wrapperRef}
        className="relative"
        onMouseEnter={openOnHover ? onEnter : undefined}
        onMouseLeave={openOnHover ? onLeave : undefined}
      >
        {trigger}
        {effectiveOpen && (
          <>
            {/* click-outside catcher：覆盖全屏，点击即关闭（hover 模式不需要） */}
            {!openOnHover && <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden="true" />}
            <div
              className={clsx(
                "absolute rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1",
                side === "bottom" ? "mt-1" : "mb-1",
                align === "left" ? "left-0" : "right-0",
                side === "bottom" ? "top-full" : "bottom-full",
                panelZ,
                panelClassName,
              )}
            >
              {children}
            </div>
          </>
        )}
      </div>
    </PopoverCloseContext.Provider>
  );
}

Popover.displayName = "Popover";
export default Popover;
