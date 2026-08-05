"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { useClickOutside } from "@/shared/lib/useClickOutside";

export interface PopoverProps {
  /** 受控显隐状态:click 模式由外部持有;openOnHover 模式可省略(内部 hovered 控制)。 */
  open?: boolean;
  /** 关闭回调(点击外部或面板内 requestClose 时触发);openOnHover 模式可省略。 */
  onClose?: () => void;
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
  /** 浮层面板 z-index 层级（默认 z-30）。 */
  panelZ?: string;
  /** 是否 Portal 到 document.body；原生 <dialog> 内应关闭，以保留 top-layer 层级。 */
  portal?: boolean;
  /**
   * 是否改为 hover 打开（默认 false）。
   * 开启后由内部 hovered state 控制：鼠标进入触发器/面板即展开，离开延迟 150ms 收起，
   * 不挂 click-outside 监听。供面板内子项通过 PopoverCloseContext 请求立即关闭。
   */
  openOnHover?: boolean;
  /** openOnHover 模式下打开前的悬停延迟(ms),默认 0(立即);避免快速划过误开。 */
  hoverDelayMs?: number;
  /** openOnHover 模式下是否响应 click 立即 toggle(不等延迟);默认 false。 */
  clickToggle?: boolean;
}

/**
 * PopoverCloseContext -- 供面板内子组件（如 OptionPicker）请求立即关闭。
 * click 模式下转调 onClose；hover 模式下清空 hovered。
 */
const PopoverCloseContext = createContext<() => void>(() => {});
/** 读取当前 Popover 的关闭函数（用于面板内点击选项后立即收起）。 */
export const usePopoverClose = () => useContext(PopoverCloseContext);

/**
 * Popover -- 域无关的受控浮层壳。
 *
 * 面板用 position: fixed 相对视口定位,默认通过 createPortal 渲染到 document.body,
 * 避免被祖先 overflow 裁剪或被 containing block 劫持;原生 dialog 内可关闭 Portal 以保留 top-layer 层级。
 * 位置由 useLayoutEffect 依据 trigger(wrapper) 的 getBoundingClientRect 计算,
 * 并在 scroll/resize/面板尺寸变化时重算,使面板跟随 trigger 滚动。
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
  portal = true,
  openOnHover = false,
  hoverDelayMs = 0,
  clickToggle = false,
}: PopoverProps) {
  const [hovered, setHovered] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const onEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (hoverDelayMs > 0) {
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => setHovered(true), hoverDelayMs);
    } else {
      setHovered(true);
    }
  };
  const onLeave = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    // 延迟收起,给鼠标从触发器移到面板留出过渡时间
    closeTimer.current = setTimeout(() => setHovered(false), 150);
  };
  const onWrapperClick = () => {
    if (!openOnHover || !clickToggle) return;
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    setHovered((h) => !h);
  };

  const effectiveOpen = openOnHover ? hovered : (open ?? false);
  const close = useCallback(() => {
    if (openOnHover) setHovered(false);
    else onClose?.();
  }, [openOnHover, onClose]);

  // click 模式:document 级外部点击关闭。不用 fixed 全屏透明遮罩——
  // 那层遮罩会整页盖住,体感像「还罩着一个框」,且在 transform 祖先内会失效。
  useClickOutside([wrapperRef, panelRef], close, effectiveOpen && !openOnHover);

  // fixed 定位:面板相对视口,按 align/side 贴齐 trigger(wrapper),并 clamp 到视口内。
  // scroll/resize/面板尺寸变化时重算,使面板跟随 trigger 滚动且不被 overflow 裁剪。
  // 直接写 panel.style(命令式),避免 effect 内 setState 触发级联重渲染。
  useLayoutEffect(() => {
    if (!effectiveOpen) return;
    const wrapper = wrapperRef.current;
    const panel = panelRef.current;
    if (!wrapper || !panel) return;
    let raf = 0;
    let scheduled = false;
    const compute = () => {
      const wr = wrapper.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const gap = 4;
      let left = align === "right" ? wr.right - pw : wr.left;
      let top = side === "bottom" ? wr.bottom + gap : wr.top - ph - gap;
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    // scroll/resize 高频,用 rAF 合并到帧末,避免每事件一次重算。
    const onScrollResize = () => {
      if (scheduled) return;
      scheduled = true;
      raf = requestAnimationFrame(() => { scheduled = false; compute(); });
    };
    // 初始隐藏,compute 后定位并显示(避免首帧闪在 0,0)。
    panel.style.visibility = "hidden";
    compute();
    raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute);
    ro.observe(panel);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [effectiveOpen, align, side]);

  const ctx = close;
  // data-popover-root:供父级 useClickOutside 识别 Portal 面板,点选项时不误关父菜单。
  const floatingContent = (
    <div
      ref={panelRef}
      data-popover-root=""
      // 面板内点击不冒泡到 wrapper,避免 clickToggle 模式下点面板误触发 toggle 关闭。
      onClick={(e) => e.stopPropagation()}
      // Portal 时面板脱离 wrapper,hover 模式需自绑 enter/leave 保持跨元素悬停连续。
      onMouseEnter={openOnHover ? onEnter : undefined}
      onMouseLeave={openOnHover ? onLeave : undefined}
      style={{ visibility: "hidden" }}
      className={clsx(
        "fixed rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1",
        panelZ,
        panelClassName,
      )}
    >
      {children}
    </div>
  );

  return (
    <PopoverCloseContext.Provider value={ctx}>
      <div
        ref={wrapperRef}
        className="relative"
        onMouseEnter={openOnHover ? onEnter : undefined}
        onMouseLeave={openOnHover ? onLeave : undefined}
        onClick={openOnHover && clickToggle ? onWrapperClick : undefined}
      >
        {trigger}
        {typeof document !== "undefined" && effectiveOpen && (
          portal ? createPortal(floatingContent, document.body) : floatingContent
        )}
      </div>
    </PopoverCloseContext.Provider>
  );
}

Popover.displayName = "Popover";
export default Popover;
