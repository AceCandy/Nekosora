"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import type { NavGroup } from "@/shared/nav-config";

interface SidebarNavProps {
  /** 分组导航数据,由 nav-config 工厂函数生成。 */
  groups: NavGroup[];
  /**
   * active 判定方式:
   *   - "exact":pathname === item.href(适合 /panel 的精确路由)
   *   - "prefix":pathname.startsWith(item.href)(适合 /admin 的子路由树)
   */
  matchMode?: "exact" | "prefix";
}

/**
 * 共享侧栏导航(client component)。
 *
 * 渲染分组小标题(可选)+ 导航链接,并支持数字快捷键(1 起始,跨分组连续编号)。
 * 合并了原 panel/SidebarNav 与 admin/AdminSidebarNav 的实现,差异由 groups 数据与
 * matchMode 驱动,不再各自硬编码 navItems。
 */
export default function SidebarNav({ groups, matchMode = "exact" }: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");

  // 展开为扁平的有序列表,用于数字快捷键索引(1 起始,跨分组连续)。
  const flatItems = groups.flatMap((g) => g.items);

  // 预计算每个分组内项的全局序号(1 起始,跨分组连续),渲染时按 href 取值,
  // 避免在 .map 回调里自增计数器(触发 react-compiler 渲染后改值规则)。
  const hotkeyByHref = new Map<string, number>();
  flatItems.forEach((item, i) => hotkeyByHref.set(item.href, i + 1));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.getAttribute("contenteditable") === "true");
      if (isInput) return;

      const num = parseInt(e.key, 10);
      if (Number.isNaN(num) || num < 1) return;
      const target = flatItems[num - 1];
      if (target) {
        e.preventDefault();
        router.push(target.href);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flatItems, router]);

  return (
    <nav className="space-y-4">
      {groups.map((group, groupIdx) => (
        <div key={group.titleKey ?? groupIdx} className="space-y-1">
          {group.titleKey && (
            <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {t(group.titleKey)}
            </div>
          )}
          {group.items.map((item) => {
            const hotkey = hotkeyByHref.get(item.href) ?? 0;
            const isActive =
              matchMode === "prefix"
                ? pathname.startsWith(item.href)
                : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "group/nav flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 ease-out",
                  isActive
                    ? "bg-sora-blue/8 text-sora-blue dark:bg-sora-blue/10"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-900/50",
                )}
              >
                <span>{t(item.labelKey)}</span>
                <span className="hidden border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 opacity-0 transition-opacity group-hover/nav:opacity-100 dark:border-neutral-800 dark:text-neutral-500 sm:inline-block">
                  {hotkey}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
