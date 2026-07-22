"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Popover 等 Portal 浮层根节点标记,useClickOutside 忽略其内部点击以免拆掉父菜单。 */
export const POPOVER_ROOT_ATTR = "data-popover-root";

/**
 * 点击/触控 ref 容器外时触发 onOutside。
 *
 * 用于替代「组件树内 fixed inset-0 遮罩」做 click-outside：
 * 祖先有 transform / filter / backdrop-filter 时，内部 fixed 只会相对祖先定位，
 * 遮罩盖不全视口，点主内容区无法关闭。document 级 pointerdown 不受此限制。
 *
 * 会忽略 `[data-popover-root]` 内的点击(Portal 到 body 的 Popover 面板/遮罩),
 * 避免父菜单在子 OptionPicker 点选时被先拆掉。
 *
 * 视觉遮罩（移动端抽屉、模态）仍应继续用 fixed 覆盖层，不要套本 hook。
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled: boolean,
): void {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      // Portal 浮层:点面板选项或 Popover 自有遮罩时,由 Popover 自己收起,不连坐父菜单。
      if (target instanceof Element && target.closest(`[${POPOVER_ROOT_ATTR}]`)) return;
      onOutsideRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [enabled, ref]);
}
