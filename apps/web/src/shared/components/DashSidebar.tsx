"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, LogOut, MessageSquare, X } from "lucide-react";
import type { SessionUser } from "@/lib/session";
import type { NavGroup } from "@/shared/nav-config";
import type { FooterLink } from "@/shared/components/AppShell";
import SidebarNav from "@/shared/components/SidebarNav";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { useClickOutside } from "@/shared/lib/useClickOutside";

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
 * 导航变 icon-only(hover tooltip)、底部保留用户菜单入口。会话内状态,不持久化(同 chat)。
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("nav");
  const displayName = user.name.trim() || user.email;

  useClickOutside(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const syncViewport = () => {
      setIsMobileViewport(!media.matches);
      if (media.matches) setMobileOpen(false);
    };

    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const mobileTrigger = mobileTriggerRef.current;
    const mainContent = document.getElementById("dash-main-content");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mainContent?.setAttribute("inert", "");
    mainContent?.setAttribute("aria-hidden", "true");
    mobileCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      mainContent?.removeAttribute("inert");
      mainContent?.removeAttribute("aria-hidden");
      document.removeEventListener("keydown", handleKeyDown);
      requestAnimationFrame(() => {
        if (mobileTrigger?.isConnected) mobileTrigger.focus();
      });
    };
  }, [mobileOpen]);

  const openMobileSidebar = () => {
    setCollapsed(false);
    setMobileOpen(true);
  };

  return (
    <>
      <header
        aria-hidden={mobileOpen ? true : undefined}
        inert={mobileOpen ? true : undefined}
        className="flex h-14 shrink-0 items-center gap-3 border-b border-morning-mist bg-nebula-white px-3   md:hidden"
      >
        <button
          ref={mobileTriggerRef}
          type="button"
          onClick={openMobileSidebar}
          className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue   "
          aria-controls="dash-sidebar"
          aria-expanded={mobileOpen}
          aria-label={t("openSidebar")}
          title={t("openSidebar")}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link
          href={brandHref}
          className="min-w-0 truncate rounded text-ui-reading font-semibold text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue "
        >
          Nekusora
        </Link>
      </header>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        ref={sidebarRef}
        id="dash-sidebar"
        role={isMobileViewport ? "dialog" : undefined}
        aria-modal={isMobileViewport && mobileOpen ? true : undefined}
        aria-label={isMobileViewport ? t("sidebarNavigation") : undefined}
        aria-hidden={isMobileViewport && !mobileOpen ? true : undefined}
        inert={isMobileViewport && !mobileOpen ? true : undefined}
        onClick={(event) => {
          if (isMobileViewport && (event.target as HTMLElement).closest("a")) setMobileOpen(false);
        }}
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex min-h-0 w-[min(18rem,calc(100vw-3rem))] max-w-72 flex-col border-r border-morning-mist bg-nebula-white p-4 transition-transform duration-200 ease-out   md:static md:z-40 md:translate-x-0 md:transition-[width,min-width,max-width,transform] md:duration-250 md:ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed
            ? "md:w-14 md:min-w-14 md:max-w-14 md:p-2"
            : "md:w-60 md:min-w-60 md:max-w-60 md:p-3",
        )}
      >
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
          <div className={clsx("flex items-center", collapsed ? "justify-center" : "justify-between px-1 py-1")}>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <Link
                  href={brandHref}
                  className="block truncate rounded text-ui-heading font-bold text-neutral-900 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue "
                >
                  Nekusora
                </Link>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="touch-target hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue   md:inline-flex"
              aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
              title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
            <button
              ref={mobileCloseRef}
              type="button"
              onClick={() => setMobileOpen(false)}
              className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue   md:hidden"
              aria-label={t("closeSidebar")}
              title={t("closeSidebar")}
            >
              <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
          <SidebarNav groups={groups} matchMode={matchMode} collapsed={collapsed} />
        </div>

        <div ref={userMenuRef} className="relative mt-2 shrink-0 border-t border-morning-mist pt-3 ">
          {userMenuOpen && (
            <div
              className={clsx(
                "absolute bottom-full left-0 right-0 z-30 mb-2 rounded-lg border border-morning-mist bg-white p-1 shadow-lg  ",
                collapsed && "md:bottom-0 md:left-full md:right-auto md:mb-0 md:ml-2 md:w-48",
              )}
            >
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => {
                    setUserMenuOpen(false);
                    setMobileOpen(false);
                  }}
                  className="touch-target flex items-center gap-2 rounded-md px-3 py-2 text-ui-body text-neutral-700 hover:bg-neutral-100  "
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  {link.label}
                </Link>
              ))}
              <LanguageSwitcher className="touch-target flex w-full rounded-md px-3 py-2 hover:bg-neutral-100 " />
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="touch-target flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-ui-body text-danger hover:bg-red-50 "
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {t("logout")}
                </button>
              </form>
            </div>
          )}
          <button
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            className={clsx(
              "touch-target flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue ",
              collapsed && "md:justify-center",
            )}
            aria-expanded={userMenuOpen}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sora-blue/10 text-ui-caption font-semibold text-sora-blue">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className={clsx("min-w-0 flex-1", collapsed && "md:hidden")}>
              <span className="block truncate text-ui-body font-semibold text-neutral-800 ">{displayName}</span>
              <span className="mt-0.5 block truncate font-mono text-ui-caption text-ink-tertiary ">
                {user.email}{brandBadge ? ` (${brandBadge})` : ""}
              </span>
            </span>
            <ChevronDown
              className={clsx("h-4 w-4 shrink-0 text-neutral-400 transition-transform", userMenuOpen && "rotate-180", collapsed && "md:hidden")}
              aria-hidden="true"
            />
          </button>
        </div>
      </aside>
    </>
  );
}
