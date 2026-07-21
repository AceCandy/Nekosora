"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { PanelLeftClose, PanelLeftOpen, LogOut, MessageSquare } from "lucide-react";
import type { SessionUser } from "@/lib/session";
import type { NavGroup } from "@/shared/nav-config";
import type { FooterLink } from "@/shared/components/AppShell";
import SidebarNav from "@/shared/components/SidebarNav";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";

interface DashSidebarProps {
  user: SessionUser;
  groups: NavGroup[];
  brandHref: string;
  brandBadge?: string;
  matchMode?: "exact" | "prefix";
  footerLinks: FooterLink[];
  /** 登出 server action,由 AppShell(server)定义并透传,避免 client/服务端两套实现。 */
  logoutAction: () => Promise<void>;
}

/**
 * dash 后台侧栏(client) -- 管理「收起」状态。
 *
 * 参考聊天页 Sidebar 的收起交互:桌面端折叠按钮切换 collapsed,收起后 aside 变窄、
 * 导航变 icon-only(hover tooltip)、底部操作图标化。会话内状态,不持久化(同 chat)。
 */
export default function DashSidebar({
  user,
  groups,
  brandHref,
  brandBadge,
  matchMode = "exact",
  footerLinks = [],
  logoutAction,
}: DashSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslations("nav");

  return (
    <aside
      className={clsx(
        "flex w-56 flex-col justify-between border-r border-morning-mist p-4 transition-[width,min-width,max-width,padding] duration-250 ease-in-out dark:border-deep-space md:w-56 md:min-w-56 md:max-w-56",
        collapsed && "md:w-14 md:min-w-14 md:max-w-14 md:p-2",
      )}
    >
      <div className="space-y-6">
        <div className={clsx("flex items-center", collapsed ? "justify-center py-1" : "px-3 py-2")}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <Link
                href={brandHref}
                className="block truncate text-lg font-bold tracking-tight text-neutral-900 transition-opacity hover:opacity-80 dark:text-white"
              >
                Nekusora
              </Link>
              <div className="mt-0.5 truncate font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                {user.email}
                {brandBadge ? ` (${brandBadge})` : ""}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:hover:bg-neutral-900 dark:hover:text-neutral-100 md:inline-flex"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        </div>
        <SidebarNav groups={groups} matchMode={matchMode} collapsed={collapsed} />
      </div>

      <div
        className={clsx(
          "border-t border-morning-mist pt-4 dark:border-deep-space",
          collapsed ? "space-y-1" : "space-y-2",
        )}
      >
        {collapsed ? (
          <>
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                aria-label={link.label}
                className="flex items-center justify-center rounded-md p-2 text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900/50 dark:hover:text-neutral-100"
              >
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
              </Link>
            ))}
            <form action={logoutAction}>
              <button
                type="submit"
                title={t("logout")}
                aria-label={t("logout")}
                className="flex w-full items-center justify-center rounded-md p-2 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </>
        ) : (
          <>
            <LanguageSwitcher className="block rounded-md px-3 py-2" />
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-all duration-150 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900/50 dark:hover:text-neutral-100"
              >
                {link.label}
              </Link>
            ))}
            <form action={logoutAction}>
              <button className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-red-500 transition-all duration-150 hover:bg-red-50 dark:hover:bg-red-950/20">
                {t("logout")}
              </button>
            </form>
          </>
        )}
      </div>
    </aside>
  );
}
