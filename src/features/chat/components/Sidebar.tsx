"use client";

import React, { useMemo, useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { searchMessages } from "@/features/chat/actions/conversations";
import Modal from "@/shared/ui/Modal";
import { Plus, Settings2, LogOut, Menu, X, Search, Pin, Archive, Trash2, ImageIcon, Loader2, PanelLeftClose, PanelLeftOpen, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import { useClickOutside } from "@/shared/lib/useClickOutside";

interface ConversationItem {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  generating: boolean;
  updatedAt: number;
}

/** 全文搜索单条命中结果(按消息粒度)。 */
interface SearchResult {
  conversationId: string;
  conversationTitle: string;
  messagePublicId: string;
  snippet: string;
  createdAt: number;
}

interface SidebarProps {
  userName: string;
  userEmail: string;
  conversations: ConversationItem[];
  newConversationText: string;
  conversationsText: string;
  noConversationsText: string;
  settingsText: string;
  logoutText: string;
  groupPinnedText: string;
  groupTodayText: string;
  groupYesterdayText: string;
  groupDayBeforeYesterdayText: string;
  groupWithinWeekText: string;
  groupWithinMonthText: string;
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
  /** 轮询各会话 generating 状态,用于检测后台会话完成。 */
  getGeneratingStatusesAction: () => Promise<{ id: string; generating: boolean }[]>;
}

/** 把 keyword 在片段中高亮(大小写不敏感),返回 React 节点数组。 */
function highlightSnippet(text: string, keyword: string): React.ReactNode {
  const kw = keyword.trim();
  if (!kw) return text;
  const lower = text.toLowerCase();
  const kwl = kw.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(kwl, i);
  let key = 0;
  while (idx >= 0) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="bg-sora-blue/20 text-inherit rounded px-0.5">
        {text.slice(idx, idx + kw.length)}
      </mark>,
    );
    i = idx + kw.length;
    idx = lower.indexOf(kwl, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

/** 按更新时间归入近 7 天 / 近 30 天的互斥时间分组。 */
function dayBucket(ts: number): "today" | "yesterday" | "dayBeforeYesterday" | "withinWeek" | "withinMonth" | "earlier" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const boundary = (daysAgo: number) => {
    const date = new Date(startOfToday);
    date.setDate(date.getDate() - daysAgo);
    return date.getTime();
  };
  const start = startOfToday.getTime();
  if (ts >= start) return "today";
  if (ts >= boundary(1)) return "yesterday";
  if (ts >= boundary(2)) return "dayBeforeYesterday";
  if (ts >= boundary(7)) return "withinWeek";
  if (ts >= boundary(30)) return "withinMonth";
  return "earlier";
}

export default function Sidebar({
  userName,
  userEmail,
  conversations,
  newConversationText,
  conversationsText,
  noConversationsText,
  settingsText,
  logoutText,
  groupPinnedText,
  groupTodayText,
  groupYesterdayText,
  groupDayBeforeYesterdayText,
  groupWithinWeekText,
  groupWithinMonthText,
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
  getGeneratingStatusesAction,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(["earlier", "archived"]));
  const tSidebar = useTranslations("chat");
  const tNav = useTranslations("nav");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const displayName = userName.trim() || userEmail;
  const userMenuRef = useRef<HTMLDivElement>(null);
  // 当前展开的会话操作菜单容器(触发按钮 + 面板),用于点击外部收起。
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);
  // 会话项「更多操作」:侧栏 aside 带 transform,不能用内部 fixed 遮罩;统一走 useClickOutside。
  useClickOutside(sessionMenuRef, () => setMenuOpenId(null), Boolean(menuOpenId));

  // 当前路由对应的会话 id(/chat/{id});新对话页 /chat 为 null。
  const pathname = usePathname();
  const pathConvId = useMemo(() => {
    const m = pathname?.match(/^\/chat\/([^/]+)$/);
    return m ? m[1] : null;
  }, [pathname]);
  // 订阅 store:进行中的会话(generating 转圈)+ 活跃会话(replaceState 后即时高亮)+ 乐观新会话项。
  const streamingConvIds = useChatStreamStore(
    useShallow((s) => Object.entries(s.runtimes).filter(([, r]) => r.streaming).map(([k]) => k)),
  );
  const activeConversationId = useChatStreamStore((s) => s.activeConversationId);
  const optimisticConversation = useChatStreamStore((s) => s.optimisticConversation);
  // 高亮优先路由解析(导航后即时正确);replaceState 后 Next pathname 暂未更新时回落到 store 活跃 id。
  const activeConvId = pathConvId ?? activeConversationId;

  // 后台会话完成蓝点:轮询各会话 generating 状态,记录上一轮「生成中」的集合;
  // 当某会话从「生成中」变为「已完成」且不是当前会话,标记蓝点;点击该会话项清除。
  const router = useRouter();
  const prevGeneratingRef = useRef<Set<string> | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  // 仅当存在后台生成中会话时才轮询(检测其完成 → 蓝点);无任何生成会话时完全静默,
  // 避免空闲态每 6s 空打 server action。hasGenerating 来自 SSR 会话列表,
  // 当前会话开始/结束生成时由 useChatRuntime 的 refresh 同步驱动此开关。
  const hasGenerating = conversations.some((c) => c.generating);
  useEffect(() => {
    if (!hasGenerating) {
      // 无生成中会话:重置基线,不启动轮询
      prevGeneratingRef.current = null;
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const statuses = await getGeneratingStatusesAction();
        if (cancelled) return;
        const nowGenerating = new Set(statuses.filter((s) => s.generating).map((s) => s.id));
        const prev = prevGeneratingRef.current;
        if (prev !== null) {
          // 从「生成中」变为「未生成」且非当前会话 → 标记完成
          const newlyDone: string[] = [];
          prev.forEach((id) => {
            if (!nowGenerating.has(id) && id !== activeConvId) newlyDone.push(id);
          });
          if (newlyDone.length > 0) {
            setCompletedIds((cur) => {
              const next = new Set(cur);
              newlyDone.forEach((id) => next.add(id));
              return next;
            });
          }
        }
        prevGeneratingRef.current = nowGenerating;
        // 本轮查询反映出生成状态变化(有会话刚完成,或已无任何生成中会话):
        // 刷新 SSR 同步 generating 字段,使 hasGenerating 收敛、轮询自然停止,
        // 并让侧栏转圈及时消失。
        const changed = prev !== null && [...prev].some((id) => !nowGenerating.has(id));
        if (nowGenerating.size === 0 || changed) router.refresh();
      } catch {
        /* 轮询失败静默,下轮重试 */
      }
    };
    poll();
    const timer = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // activeConvId 进依赖:切换会话时立即重算(避免刚完成的当前会话残留蓝点)
  }, [hasGenerating, activeConvId, getGeneratingStatusesAction, router]);

  // 全文搜索:query 非空时防抖(300ms)调 searchMessages 跨会话搜消息内容
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setSearching(true);
      void searchMessages(q)
        .then((results) => { if (!cancelled) setSearchResults(results); })
        .catch((err) => { console.error("search messages failed:", err); if (!cancelled) setSearchResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const clearCompleted = (id: string) => {
    setCompletedIds((cur) => {
      if (!cur.has(id)) return cur;
      const next = new Set(cur);
      next.delete(id);
      return next;
    });
  };

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

  // 合并乐观新会话项。SSR 未带上时插入列表头;SSR 已命中同 id 时,用乐观项 title
  // 覆盖 SSR title —— SSR 的 title 可能停在 "新会话"(revalidatePath 重取早于
  // maybeGenerateTitle 写库),而乐观项 title 被 SSE title_updated 持续刷新成
  // fallback / 真实摘要。新会话场景跳过 router.refresh(),SSR 不会自动追上,
  // 必须由乐观项 title 接管显示,直到整页刷新(store 重置、SSR 读 DB 最新值)。
  const allConversations = useMemo(() => {
    if (!optimisticConversation) return conversations;
    const optTitle = optimisticConversation.title || newConversationText;
    if (conversations.some((c) => c.id === optimisticConversation.id)) {
      return conversations.map((c) =>
        c.id === optimisticConversation.id ? { ...c, title: optTitle } : c,
      );
    }
    return [
      {
        id: optimisticConversation.id,
        title: optTitle,
        pinned: false,
        archived: false,
        generating: false,
        updatedAt: optimisticConversation.createdAt,
      },
      ...conversations,
    ];
  }, [conversations, optimisticConversation, newConversationText]);

  // 分组:置顶 / 今天 / 昨天 / 前天 / 周内 / 月内 / 更早 / 归档
  const groups = useMemo(() => {
    const pinned: ConversationItem[] = [];
    const today: ConversationItem[] = [];
    const yesterday: ConversationItem[] = [];
    const dayBeforeYesterday: ConversationItem[] = [];
    const withinWeek: ConversationItem[] = [];
    const withinMonth: ConversationItem[] = [];
    const earlier: ConversationItem[] = [];
    const archived: ConversationItem[] = [];
    for (const c of allConversations) {
      if (c.archived) archived.push(c);
      else if (c.pinned) pinned.push(c);
      else {
        const b = dayBucket(c.updatedAt);
        if (b === "today") today.push(c);
        else if (b === "yesterday") yesterday.push(c);
        else if (b === "dayBeforeYesterday") dayBeforeYesterday.push(c);
        else if (b === "withinWeek") withinWeek.push(c);
        else if (b === "withinMonth") withinMonth.push(c);
        else earlier.push(c);
      }
    }
    return { pinned, today, yesterday, dayBeforeYesterday, withinWeek, withinMonth, earlier, archived };
  }, [allConversations]);

  const sections: { key: string; label: string; items: ConversationItem[] }[] = [
    { key: "pinned", label: groupPinnedText, items: groups.pinned },
    { key: "today", label: groupTodayText, items: groups.today },
    { key: "yesterday", label: groupYesterdayText, items: groups.yesterday },
    { key: "dayBeforeYesterday", label: groupDayBeforeYesterdayText, items: groups.dayBeforeYesterday },
    { key: "withinWeek", label: groupWithinWeekText, items: groups.withinWeek },
    { key: "withinMonth", label: groupWithinMonthText, items: groups.withinMonth },
    { key: "earlier", label: groupEarlierText, items: groups.earlier },
    { key: "archived", label: groupArchivedText, items: groups.archived },
  ].filter((s) => s.items.length > 0);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openMobileSidebar = () => {
    setCollapsed(false);
    setIsOpen(true);
  };

  const renderItem = (c: ConversationItem) => {
    const isActive = c.id === activeConvId;
    const justCompleted = !isActive && completedIds.has(c.id);
    const handleClick = () => {
      setIsOpen(false);
      if (justCompleted) clearCompleted(c.id);
    };
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
        onClick={handleClick}
        aria-current={isActive ? "page" : undefined}
        className={clsx(
          "inline-flex min-w-0 max-w-full w-full items-center gap-2 overflow-hidden rounded-md px-3 py-2 pr-8 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
          isActive
            ? "bg-sora-blue/[0.08] text-neutral-900 dark:text-white font-semibold"
            : "text-neutral-600 dark:text-neutral-450 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        {(c.generating || streamingConvIds.includes(c.id)) && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-sora-blue" aria-label="生成中" />}
        {justCompleted && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-sora-blue" aria-label="有新回复" />}
      </Link>
      {/* 仅包住触发按钮 + 面板;点击标题/其它区域都算外部,可收起菜单 */}
      <div ref={menuOpenId === c.id ? sessionMenuRef : undefined}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpenId((cur) => (cur === c.id ? null : c.id));
          }}
          className="touch-target absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
          aria-label="更多操作"
          aria-haspopup="menu"
          aria-expanded={menuOpenId === c.id}
        >
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        {menuOpenId === c.id && (
          <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-md border border-morning-mist dark:border-deep-space bg-white dark:bg-space-ink shadow-lg p-1">
            <button
              type="button"
              onClick={() => runAction(togglePinnedAction, c.id)}
              className="touch-target w-full text-left rounded px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Pin className="w-3 h-3" aria-hidden="true" />
              <span>{c.pinned ? actionUnpinText : actionPinText}</span>
            </button>
            <button
              type="button"
              onClick={() => runAction(toggleArchivedAction, c.id)}
              className="touch-target w-full text-left rounded px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Archive className="w-3 h-3" aria-hidden="true" />
              <span>{c.archived ? actionUnarchiveText : actionArchiveText}</span>
            </button>
            <button
              type="button"
              onClick={() => runAction(deleteAction, c.id, true)}
              className="touch-target w-full text-left rounded px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              <span>{actionDeleteText}</span>
            </button>
          </div>
        )}
      </div>
    </div>
    );
  };

  return (
    <>
      {/* Mobile header */}
      <header
        aria-hidden={isOpen ? true : undefined}
        inert={isOpen ? true : undefined}
        className="flex h-14 shrink-0 items-center gap-3 border-b border-morning-mist bg-nebula-white px-3 dark:border-deep-space dark:bg-twilight-obsidian md:hidden"
      >
        <button
          type="button"
          onClick={openMobileSidebar}
          className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          aria-controls="chat-sidebar"
          aria-expanded={isOpen}
          aria-label={tNav("openSidebar")}
          title={tNav("openSidebar")}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link
          href="/chat"
          className="min-w-0 truncate rounded text-base font-semibold text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-white"
        >
          Nekusora
        </Link>
      </header>

      {/* Backdrop overlay for mobile drawer */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Actual Sidebar Panel */}
      <aside
        id="chat-sidebar"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex min-h-0 w-[min(18rem,calc(100vw-3rem))] max-w-72 shrink-0 flex-col border-r border-morning-mist bg-nebula-white p-4 transform transition-transform duration-200 ease-out dark:border-deep-space dark:bg-[#090b0e] md:static md:z-40 md:h-screen md:translate-x-0 md:transition-[width,min-width,max-width,transform] md:duration-250 md:ease-in-out",
          collapsed ? "md:w-14 md:min-w-14 md:max-w-14 md:p-2" : "md:w-60 md:min-w-60 md:max-w-60 md:p-3",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className={clsx("shrink-0 flex items-center", collapsed ? "justify-center" : "justify-between px-1 py-1")}>
          <div className={clsx("min-w-0", collapsed && "hidden")}>
            <Link
              href="/"
              onClick={() => setIsOpen(false)}
              className="block rounded text-2xl font-bold text-neutral-900 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-white"
            >
              Nekusora
            </Link>
          </div>
          <div className="flex items-center gap-1">
            {!collapsed && (
              <button type="button" onClick={() => setSearchOpen(true)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:hover:bg-neutral-900 dark:hover:text-neutral-100" aria-label={searchText} title={searchText}>
                <Search className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="touch-target hidden h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue md:inline-flex"
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            >
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:hover:bg-neutral-900 dark:hover:text-neutral-100 md:hidden"
              aria-label={tNav("closeSidebar")}
              title={tNav("closeSidebar")}
            >
              <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav className={clsx("min-h-0 flex-1 flex-col items-center gap-1.5 pt-3", collapsed ? "hidden md:flex" : "hidden")} aria-label="快捷导航">
          <Link href="/chat" className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-800 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800" aria-label={newConversationText} title={newConversationText}>
            <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => setSearchOpen(true)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-neutral-300 dark:hover:bg-neutral-900" aria-label={searchText} title={searchText}>
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <Link href="/image" className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue dark:text-neutral-300 dark:hover:bg-neutral-900" aria-label={imageText} title={imageText}>
            <ImageIcon className="h-[18px] w-[18px]" aria-hidden="true" />
          </Link>
        </nav>

        <div className={clsx("flex min-h-0 flex-1 flex-col", collapsed && "md:hidden")}>
          {/* New Conversation Button */}
          <Link
            href="/chat"
            onClick={() => setIsOpen(false)}
            className="touch-target mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-morning-mist dark:border-deep-space hover:bg-neutral-50 dark:hover:bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200 transition-[background-color,color,border-color,box-shadow] duration-150 ease-out shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
          >
            <Plus className="w-4 h-4 text-sora-blue" aria-hidden="true" />
            <span>{newConversationText}</span>
          </Link>

        {/* 图像工作区入口 */}
        <Link
          href="/image"
          onClick={() => setIsOpen(false)}
          className="touch-target inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-450 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        >
          <ImageIcon className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
          <span>{imageText}</span>
        </Link>

        {/* Conversations List Label */}
        <div className="mt-3 px-3 py-1.5 text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider shrink-0 select-none">
          {conversationsText}
        </div>

        {/* Scrollable Conversation List */}
        <div className="scroll-fade-y flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
          {sections.length === 0 ? (
            <p className="text-xs text-neutral-400 px-3 py-2">{noConversationsText}</p>
          ) : (
            sections.map((section) => (
              <div key={section.key}>
                <button type="button" onClick={() => toggleGroup(section.key)} className="touch-target flex w-full items-center gap-2 px-3 py-2 text-[11px] font-medium text-neutral-450 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue dark:text-neutral-500 dark:hover:text-neutral-300" aria-expanded={!collapsedGroups.has(section.key)}>
                  <span>{section.label}</span>
                  <span className="h-px min-w-4 flex-1 bg-morning-mist/80 dark:bg-deep-space/70" aria-hidden="true" />
                  <span className="text-neutral-300 dark:text-neutral-700">{section.items.length}</span>
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", collapsedGroups.has(section.key) && "-rotate-90")} aria-hidden="true" />
                </button>
                {!collapsedGroups.has(section.key) && <div className="space-y-0.5">{section.items.map(renderItem)}</div>}
              </div>
            ))
          )}
        </div>

        </div>

        {/* Footer user menu */}
        <div ref={userMenuRef} className="relative pt-3 mt-2 border-t border-morning-mist dark:border-deep-space shrink-0">
          {userMenuOpen && (
            <div className={clsx("absolute bottom-full left-0 right-0 z-30 mb-2 rounded-lg border border-morning-mist bg-white p-1 shadow-lg dark:border-deep-space dark:bg-space-ink", collapsed && "md:bottom-0 md:left-full md:right-auto md:mb-0 md:ml-2 md:w-48")}>
              <Link href="/panel" onClick={() => { setUserMenuOpen(false); setIsOpen(false); }} className="touch-target flex items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-900">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                {settingsText}
              </Link>
              <form onSubmit={handleSignOut}>
                <button type="submit" disabled={isPending} className="touch-target flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/20">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {logoutText}
                </button>
              </form>
            </div>
          )}
          <button type="button" onClick={() => setUserMenuOpen((value) => !value)} className={clsx("touch-target flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue", collapsed && "md:justify-center")} aria-expanded={userMenuOpen}>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sora-blue/10 text-xs font-semibold text-sora-blue">{displayName.slice(0, 1).toUpperCase()}</span>
            <span className={clsx("min-w-0 flex-1", collapsed && "md:hidden")}><span className="block truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{displayName}</span><span className="mt-0.5 block truncate text-[10px] font-mono text-neutral-450 dark:text-neutral-500">{userEmail}</span></span>
            <ChevronDown className={clsx("h-4 w-4 shrink-0 text-neutral-400 transition-transform", userMenuOpen && "rotate-180", collapsed && "md:hidden")} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title={searchText} dialogClassName="m-auto w-[min(720px,92vw)] rounded-xl border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40 dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver">
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchText} aria-label={searchText} className="w-full rounded-lg border border-morning-mist bg-white py-3 pl-10 pr-3 text-sm text-space-ink outline-none focus:border-sora-blue dark:border-deep-space dark:bg-space-ink dark:text-nebula-silver" />
          </div>
          <div className="scroll-fade-y max-h-[min(55vh,460px)] overflow-y-auto">
            {!query.trim() ? <p className="py-8 text-center text-sm text-neutral-400">{searchText}</p> : searching ? <p className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{tSidebar("searching")}</p> : searchResults.length === 0 ? <p className="py-8 text-center text-sm text-neutral-400">{tSidebar("noSearchResults")}</p> : <div className="space-y-1">{searchResults.map((r) => <Link key={`${r.conversationId}-${r.messagePublicId}-${r.createdAt}`} href={`/chat/${r.conversationId}`} onClick={() => setSearchOpen(false)} className="block rounded-lg px-3 py-3 hover:bg-neutral-100 dark:hover:bg-neutral-900"><div className="truncate text-sm font-medium">{r.conversationTitle}</div><div className="mt-1 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{highlightSnippet(r.snippet, query.trim())}</div></Link>)}</div>}
          </div>
        </div>
      </Modal>
    </>
  );
}
