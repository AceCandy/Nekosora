"use client";

import { useEffect } from "react";

/** 滚动期间为实际滚动容器添加状态类，停止 600ms 后自动移除。 */
export default function ScrollActivity() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const onScroll = (event: Event) => {
      const target = event.target instanceof HTMLElement
        ? event.target
        : document.scrollingElement instanceof HTMLElement
          ? document.scrollingElement
          : null;
      if (!target) return;
      target.classList.add("is-scrolling");
      const current = timers.get(target);
      if (current) clearTimeout(current);
      timers.set(target, setTimeout(() => {
        target.classList.remove("is-scrolling");
        timers.delete(target);
      }, 600));
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      timers.forEach(clearTimeout);
    };
  }, []);

  return null;
}
