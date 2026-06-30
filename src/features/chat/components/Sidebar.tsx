"use client";

import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Settings2, MessageSquare, LogOut, Menu, X, Search, Pin, Archive, Trash2, ImageIcon, Loader2 } from "lucide-react";
import { clsx } from "clsx";

interface ConversationItem {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  generating: boolean;
  updatedAt: number;
}

interface SidebarProps {
  userEmail: string;
  conversations: ConversationItem[];
  newConversationText: string;
  conversationsText: string;
  noConversationsText: string;
  panelText: string;
  logoutText: string;
  groupPinnedText: string;
  groupTodayText: string;
  groupYesterdayText: string;
  groupEarlierText: string;
  groupArchivedText: string;
  searchText: string;
  imageText: string;
  actionPinText: string;
  actionUnpinText: string;
  actionArchiveText: string;
  actionUnarchiveText: string;
  actionDeleteText: string;
  deleteConfirmText: string;
  signOutAction: () => Promise<void>;
  togglePinnedAction: (id: string) => Promise<void>;
  toggleArchivedAction: (id: string) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
}

/** 按更新时间归入时间分组(今天/昨天/更早)。 */
function dayBucket(ts: number): "today" | "yesterday" | "earlier" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  if (ts >= startOfToday) return "today";
  if (ts >= startOfYesterday) return "yesterday";
  return "earlier";
}

export default function Sidebar({
  userEmail,
  conversations,
  newConversationText,
  conversationsText,
  noConversationsText,
  panelText,
  logoutText,
  groupPinnedText,
  groupTodayText,
  groupYesterdayText,
  groupEarlierText,
  groupArchivedText,
  searchText,
  imageText,
  actionPinText,
  actionUnpinText,
  actionArchiveText,
  actionUnarchiveText,
  actionDeleteText,
  deleteConfirmText,
  signOutAction,
  togglePinnedAction,
  toggleArchivedAction,
  deleteAction,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 当前路由对应的会话 id(/chat/{id});新对话页 /chat 为 null,不高亮历史项。
  const pathname = usePathname();
  const activeConvId = useMemo(() => {
    const m = pathname?.match(/^\/chat\/([^/]+)$/);
    return m ? m[1] : null;
  }, [pathname]);

  const handleSignOut = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    startTransition(async () => {
      try {
        await signOutAction();
      } catch (err) {
        console.error("Sign out failed:", err);
      }
    });
  };

  const runAction = (fn: (id: string) => Promise<void>, id: string, confirm?: boolean) => {
    if (isPending) return;
    if (confirm && !window.confirm(deleteConfirmText)) return;
    setMenuOpenId(null);
    startTransition(async () => {
      try {
        await fn(id);
      } catch (err) {
        console.error("conversation action failed:", err);
      }
    });
  };

  // 前端过滤:标题搜索 + 归档默认隐藏
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!q) return true;
      return c.title.toLowerCase().includes(q);
    });
  }, [conversations, query]);

  // 分组:置顶 / 今天 / 昨天 / 更早 / 归档
  const groups = useMemo(() => {
    const pinned: ConversationItem[] = [];
    const today: ConversationItem[] = [];
    const yesterday: ConversationItem[] = [];
    const earlier: ConversationItem[] = [];
    const archived: ConversationItem[] = [];
    for (const c of filtered) {
      if (c.archived) archived.push(c);
      else if (c.pinned) pinned.push(c);
      else {
        const b = dayBucket(c.updatedAt);
        if (b === "today") today.push(c);
        else if (b === "yesterday") yesterday.push(c);
        else earlier.push(c);
      }
    }
    return { pinned, today, yesterday, earlier, archived };
  }, [filtered]);

  const sections: { key: string; label: string; items: ConversationItem[]; collapsible?: boolean }[] = [
    { key: "pinned", label: groupPinnedText, items: groups.pinned },
    { key: "today", label: groupTodayText, items: groups.today },
    { key: "yesterday", label: groupYesterdayText, items: groups.yesterday },
    { key: "earlier", label: groupEarlierText, items: groups.earlier },
    { key: "archived", label: groupArchivedText, items: groups.archived, collapsible: true },
  ].filter((s) => s.items.length > 0);

  const renderItem = (c: ConversationItem) => {
    const isActive = c.id === activeConvId;
    return (
    <div key={c.id} className="group relative">
      {isActive && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full bg-sora-blue"
          aria-hidden="true"
        />
      )}
      <Link
        href={`/chat/${c.id}`}
        onClick={() => setIsOpen(false)}
        aria-current={isActive ? "page" : undefined}
        className={clsx(
          "inline-flex w-full items-center gap-2 truncate rounded-md px-3 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
          isActive
            ? "bg-sora-blue/[0.08] text-neutral-900 dark:text-white font-semibold"
            : "text-neutral-600 dark:text-neutral-450 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900",
        )}
      >
        {c.pinned && <Pin className="w-3 h-3 shrink-0 text-sora-blue" aria-hidden="true" />}
        {c.generating ? (
          <Loader2 className="w-3.5 h-3.5 shrink-0 text-sora-blue animate-spin" aria-hidden="true" />
        ) : (
          <MessageSquare className={clsx("w-3.5 h-3.5 shrink-0", isActive ? "text-sora-blue opacity-100" : "opacity-60 text-neutral-400 dark:text-neutral-500")} aria-hidden="true" />
        )}
        <span className="truncate">{c.title}</span>
      </Link>
      {/* hover 操作按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpenId((cur) => (cur === c.id ? null : c.id));
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={menuOpenId === c.id}
      >
        <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {menuOpenId === c.id && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenuOpenId(null)} aria-hidden="true" />
          <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1">
            <button
              type="button"
              onClick={() => runAction(togglePinnedAction, c.id)}
              className="w-full text-left rounded px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Pin className="w-3 h-3" aria-hidden="true" />
              <span>{c.pinned ? actionUnpinText : actionPinText}</span>
            </button>
            <button
              type="button"
              onClick={() => runAction(toggleArchivedAction, c.id)}
              className="w-full text-left rounded px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Archive className="w-3 h-3" aria-hidden="true" />
              <span>{c.archived ? actionUnarchiveText : actionArchiveText}</span>
            </button>
            <button
              type="button"
              onClick={() => runAction(deleteAction, c.id, true)}
              className="w-full text-left rounded px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              <span>{actionDeleteText}</span>
            </button>
          </div>
        </>
      )}
    </div>
    );
  };

  return (
    <>
      {/* Mobile Top Toggle button */}
      <div className="md:hidden fixed top-3 left-4 z-40">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian text-neutral-600 dark:text-neutral-355 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
          aria-label="打开侧边栏"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Backdrop overlay for mobile drawer */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 bg-black/40 z-40 md:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Actual Sidebar Panel */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-60 border-r border-morning-mist dark:border-deep-space p-3 flex flex-col bg-nebula-white dark:bg-[#090b0e] transform transition-transform duration-250 ease-in-out md:translate-x-0 md:static md:h-screen shrink-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand & User Info */}
        <div className="px-2 py-1 shrink-0 flex items-center justify-between">
          <div className="min-w-0">
            <Link
              href="/"
              onClick={() => setIsOpen(false)}
              className="font-bold text-lg tracking-tight text-neutral-900 dark:text-white block hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue rounded"
            >
              Nekusora
            </Link>
            <div className="text-[10px] text-neutral-450 dark:text-neutral-500 font-mono mt-0.5 truncate">
              {userEmail}
            </div>
          </div>
          {/* Close button inside sidebar on mobile */}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="md:hidden p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
            aria-label="关闭侧边栏"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* New Conversation Button */}
        <Link
          href="/chat"
          onClick={() => setIsOpen(false)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-morning-mist dark:border-deep-space hover:bg-neutral-50 dark:hover:bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200 transition-all duration-150 ease-out shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        >
          <Plus className="w-4 h-4 text-sora-blue" aria-hidden="true" />
          <span>{newConversationText}</span>
        </Link>

        {/* 图像工作区入口 */}
        <Link
          href="/image"
          onClick={() => setIsOpen(false)}
          className="inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-450 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        >
          <ImageIcon className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
          <span>{imageText}</span>
        </Link>

        {/* Search box */}
        <div className="mt-3 relative shrink-0">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchText}
            className="w-full rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink pl-7 pr-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 placeholder-neutral-400 focus:outline-none focus:border-sora-blue transition-colors"
            aria-label={searchText}
          />
        </div>

        {/* Conversations List Label */}
        <div className="mt-3 px-3 py-1.5 text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider shrink-0 select-none">
          {conversationsText}
        </div>

        {/* Scrollable Grouped Conversation List */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
          {sections.length === 0 ? (
            <p className="text-xs text-neutral-400 px-3 py-2">{noConversationsText}</p>
          ) : (
            sections.map((section) => (
              <div key={section.key}>
                <div className="px-3 py-1 text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider select-none flex items-center gap-1">
                  {section.key === "pinned" && <Pin className="w-2.5 h-2.5" aria-hidden="true" />}
                  {section.key === "archived" && <Archive className="w-2.5 h-2.5" aria-hidden="true" />}
                  <span>{section.label}</span>
                  <span className="text-neutral-300 dark:text-neutral-700">{section.items.length}</span>
                </div>
                <div className="space-y-0.5">{section.items.map(renderItem)}</div>
              </div>
            ))
          )}
        </div>

        {/* Footer controls */}
        <div className="pt-3 mt-2 border-t border-morning-mist dark:border-deep-space shrink-0 space-y-0.5">
          <Link
            href="/panel"
            onClick={() => setIsOpen(false)}
            className="inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-450 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
          >
            <Settings2 className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
            <span>{panelText}</span>
          </Link>
          <form onSubmit={handleSignOut}>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all duration-150 cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              aria-label={logoutText}
            >
              <LogOut className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
              <span>{logoutText}</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
