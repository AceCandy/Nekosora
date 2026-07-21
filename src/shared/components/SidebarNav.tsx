"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import {
  Key,
  Server,
  Boxes,
  Globe,
  FileText,
  CreditCard,
  Brain,
  BookOpen,
  BarChart3,
  Users,
  Activity,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { NavGroup, NavIcon } from "@/shared/nav-config";

/** NavIcon key -> lucide 图标组件。icon 以字符串 key 跨 RSC 边界传递,在此映射为组件。 */
const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  Key,
  Server,
  Boxes,
  Globe,
  FileText,
  CreditCard,
  Brain,
  BookOpen,
  BarChart3,
  Users,
  Activity,
  Settings,
};

interface SidebarNavProps {
  /** 分组导航数据,由 nav-config 工厂函数生成。 */
  groups: NavGroup[];
  /**
   * active 判定方式:
   *   - "exact":pathname === item.href(适合 /panel 的精确路由)
   *   - "prefix":pathname.startsWith(item.href)(适合 /admin 的子路由树)
   */
  matchMode?: "exact" | "prefix";
  /** 收起态:仅展示图标,label/hotkey 隐藏,hover 由 title 提供tooltip。 */
  collapsed?: boolean;
}

/**
 * 共享侧栏导航(client component)。
 *
 * 渲染分组小标题(可选)+ 导航链接,并支持数字快捷键(1 起始,跨分组连续编号)。
 * 合并了原 panel/SidebarNav 与 admin/AdminSidebarNav 的实现,差异由 groups 数据与
 * matchMode 驱动,不再各自硬编码 navItems。
 */
export default function SidebarNav({ groups, matchMode = "exact", collapsed = false }: SidebarNavProps) {
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
    <nav className={clsx("space-y-4", collapsed && "space-y-2")}>
      {groups.map((group, groupIdx) => (
        <div key={group.titleKey ?? groupIdx} className="space-y-1">
          {group.titleKey && !collapsed && (
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
            const Icon = NAV_ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? t(item.labelKey) : undefined}
                aria-label={collapsed ? t(item.labelKey) : undefined}
                className={clsx(
                  "group/nav flex items-center rounded-md text-sm font-medium transition-all duration-150 ease-out",
                  collapsed ? "justify-center p-2" : "gap-2 px-3 py-2",
                  isActive
                    ? "bg-sora-blue/8 text-sora-blue dark:bg-sora-blue/10"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-900/50",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span className="flex-1 truncate">{t(item.labelKey)}</span>}
                {!collapsed && (
                  <span className="hidden border border-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 opacity-0 transition-opacity group-hover/nav:opacity-100 dark:border-neutral-800 dark:text-neutral-500 sm:inline-block">
                    {hotkey}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
