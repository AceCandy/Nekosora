"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

/** Popover 等 Portal 浮层根节点标记,useClickOutside 忽略其内部点击以免拆掉父菜单。 */
export const POPOVER_ROOT_ATTR = "data-popover-root";

type MaybeRef = RefObject<HTMLElement | null>;

/**
 * 点击/触控 ref 容器外时触发 onOutside。
 *
 * 用于替代「组件树内 fixed inset-0 遮罩」做 click-outside：
 * 祖先有 transform / filter / backdrop-filter 时，内部 fixed 只会相对祖先定位，
 * 遮罩盖不全视口，点主内容区无法关闭。document 级 pointerdown 不受此限制。
 *
 * - ref 可为单个或数组(如 Popover 的 trigger + 面板,面板 Portal 后不在同一子树)。
 * - 会忽略 `[data-popover-root]` 内的点击,避免父菜单在子 OptionPicker 点选时被先拆掉。
 *
 * 视觉遮罩（移动端抽屉、模态）仍应继续用 fixed 覆盖层，不要套本 hook。
 */
export function useClickOutside(
  ref: MaybeRef | MaybeRef[],
  onOutside: () => void,
  enabled: boolean,
): void {
  const onOutsideEvent = useEffectEvent(onOutside);
  const refs = Array.isArray(ref) ? ref : [ref];

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (refs.some((r) => r.current?.contains(target))) return;
      // Portal 浮层:点面板选项时由 Popover 自己处理,不连坐父菜单。
      if (target instanceof Element && target.closest(`[${POPOVER_ROOT_ATTR}]`)) return;
      onOutsideEvent();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // refs 数组每次渲染是新引用,依赖 enabled 即可;ref.current 在监听时实时读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref objects are stable
  }, [enabled, ...refs]);
}
