"use client";

import React, { useMemo, useState, useTransition, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { searchMessages } from "@/features/chat/actions/conversations";
import {
  compareConversations,
  conversationGroupFor,
  createConversationGroupBoundaries,
  encodeConversationGroupCursor,
  mergeConversationIds,
  mergeConversations,
  type ConversationGroupBoundaries,
  type ConversationGroupKey,
  type ConversationGroupPage,
  type ConversationGroupSummary,
  type ConversationNavigationItem,
} from "@/features/chat/model/conversationNavigation";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Modal from "@/shared/ui/Modal";
import Popover from "@/shared/ui/Popover";
import { Button } from "@/shared/ui/Button";
import { Plus, Settings2, LogOut, Menu, X, Search, Pin, Archive, Trash2, ImageIcon, Loader2, PanelLeftClose, PanelLeftOpen, ChevronDown, Pencil } from "lucide-react";
import { clsx } from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useChatStreamStore } from "@/features/chat/store/chatStreamStore";
import { useClickOutside } from "@/shared/lib/useClickOutside";
import { newConversationHref } from "@/features/chat/model/newConversationNavigation";

type ConversationItem = ConversationNavigationItem;

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
  nextCursor: string | null;
  initialGeneratingIds: string[];
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
  actionRenameText: string;
  renameSaveText: string;
  deleteConfirmText: string;
  signOutAction: () => Promise<void>;
  togglePinnedAction: (id: string) => Promise<void>;
  toggleArchivedAction: (id: string) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  renameAction: (id: string, title: string) => Promise<void>;
  getGroupSummaryAction: (boundaries: ConversationGroupBoundaries) => Promise<ConversationGroupSummary[]>;
  loadGroupAction: (key: ConversationGroupKey, boundaries: ConversationGroupBoundaries, cursor?: string | null) => Promise<ConversationGroupPage>;
  getConversationAction: (id: string) => Promise<ConversationItem | null>;
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

export default function Sidebar({
  userName,
  userEmail,
  conversations,
  nextCursor,
  initialGeneratingIds,
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
  actionRenameText,
  renameSaveText,
  deleteConfirmText,
  signOutAction,
  togglePinnedAction,
  toggleArchivedAction,
  deleteAction,
  renameAction,
  getGroupSummaryAction,
  loadGroupAction,
  getConversationAction,
  getGeneratingStatusesAction,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(["earlier", "archived"]));
  const tSidebar = useTranslations("chat");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ConversationItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState(false);
  const [boundaries] = useState(() => createConversationGroupBoundaries());
  const [groupSummary, setGroupSummary] = useState<ConversationGroupSummary[]>([]);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [groupLoads, setGroupLoads] = useState<Partial<Record<ConversationGroupKey, { loading: boolean; failed: boolean; nextCursor?: string | null }>>>({});
  const [navigation, setNavigation] = useState(() => ({
    source: conversations,
    conversations,
    cursor: nextCursor,
    loading: false,
    failed: false,
    generation: 0,
  }));
  const [generatingIds, setGeneratingIds] = useState(() => new Set(initialGeneratingIds));
  const [isPending, startTransition] = useTransition();
  const displayName = userName.trim() || userEmail;
  const userMenuRef = useRef<HTMLDivElement>(null);
  const conversationSwitchStartedRef = useRef(false);
  const newConversationSequenceRef = useRef(0);
  const groupRequestRef = useRef<Partial<Record<ConversationGroupKey, number>>>({});
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingLocateRef = useRef<string | null>(null);

  const loadedConversations = navigation.conversations;

  useClickOutside(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

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
  const pollingGeneratingIds = mergeConversationIds(initialGeneratingIds, streamingConvIds, [...generatingIds]);
  const pollingGeneratingKey = JSON.stringify(pollingGeneratingIds);
  const streamingGeneratingKey = JSON.stringify(mergeConversationIds(streamingConvIds));

  // RSC 传入新的数组 identity 即新导航快照；在当前 render 内切换 generation，
  // 让随后到达的旧分页响应无法写回。该条件式 props→state 调整不会形成更新循环。
  if (conversations !== navigation.source) {
    setNavigation((current) => ({
      source: conversations,
      conversations,
      cursor: nextCursor,
      loading: false,
      failed: false,
      generation: current.generation + 1,
    }));
    setGroupLoads({});
    setGeneratingIds(new Set(pollingGeneratingIds));
  }

  // 高亮优先路由解析(导航后即时正确);replaceState 后 Next pathname 暂未更新时回落到 store 活跃 id。
  const activeConvId = pathConvId ?? activeConversationId;
  const pathConversationLoaded = pathConvId
    ? loadedConversations.some(({ id }) => id === pathConvId)
    : true;

  useEffect(() => {
    if (!pathConvId || pathConversationLoaded) return;
    let cancelled = false;
    void getConversationAction(pathConvId).then((item) => {
      if (!cancelled && item) {
        setNavigation((current) => ({
          ...current,
          conversations: mergeConversations(current.conversations, [item]),
        }));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [pathConvId, pathConversationLoaded, getConversationAction]);

  useEffect(() => {
    let cancelled = false;
    void getGroupSummaryAction(boundaries)
      .then((summary) => { if (!cancelled) setGroupSummary(summary); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [boundaries, getGroupSummaryAction, summaryVersion]);

  // 后台会话完成蓝点:轮询各会话 generating 状态,记录上一轮「生成中」的集合;
  // 当某会话从「生成中」变为「已完成」且不是当前会话,标记蓝点;点击该会话项清除。
  const router = useRouter();
  const handleNewConversation = () => {
    setIsOpen(false);
    newConversationSequenceRef.current += 1;
    router.push(newConversationHref(`${Date.now()}-${newConversationSequenceRef.current}`));
  };
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  // 仅当存在后台生成中会话时才轮询。活动 id 独立于首屏窗口，后页会话也不会漏掉。
  const hasGenerating = pollingGeneratingIds.length > 0;
  useEffect(() => {
    if (!hasGenerating) {
      // 无生成中会话时完全静默，避免空闲态定时请求。
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousGenerating = new Set(pollingGeneratingIds);
    const locallyStreaming = new Set(JSON.parse(streamingGeneratingKey) as string[]);
    const poll = async () => {
      let shouldContinue = true;
      try {
        const statuses = await getGeneratingStatusesAction();
        if (cancelled) return;
        const nowGenerating = new Set(statuses.filter((s) => s.generating).map((s) => s.id));
        setGeneratingIds(nowGenerating);
        setNavigation((current) => ({
          ...current,
          conversations: current.conversations.map((item) => ({
            ...item,
            generating: nowGenerating.has(item.id),
          })),
        }));
        // 从「生成中」变为「未生成」且非当前会话 → 标记完成
        const newlyDone: string[] = [];
        previousGenerating.forEach((id) => {
          if (!nowGenerating.has(id) && id !== activeConvId) newlyDone.push(id);
        });
        if (newlyDone.length > 0) {
          setCompletedIds((cur) => {
            const next = new Set(cur);
            newlyDone.forEach((id) => next.add(id));
            return next;
          });
        }
        const changed = [...previousGenerating].some((id) => !nowGenerating.has(id));
        previousGenerating = nowGenerating;
        // 本轮查询反映出生成状态变化(有会话刚完成,或已无任何生成中会话):
        // 刷新 SSR 同步 generating 字段,使 hasGenerating 收敛、轮询自然停止,
        // 并让侧栏转圈及时消失。
        if (nowGenerating.size === 0 || changed) router.refresh();
        shouldContinue = nowGenerating.size > 0 || locallyStreaming.size > 0;
      } catch {
        /* 轮询失败静默,下轮重试 */
      } finally {
        if (!cancelled && shouldContinue) timer = setTimeout(poll, 6000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // activeConvId 进依赖:切换会话时立即重算(避免刚完成的当前会话残留蓝点)
    // 两个 key 都按内容稳定，避免 RSC refresh 只因数组引用变化重建轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGenerating, pollingGeneratingKey, streamingGeneratingKey, activeConvId, getGeneratingStatusesAction, router]);

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

  const runAction = (fn: (id: string) => Promise<void>, id: string) => {
    if (isPending) return;
    if (fn === deleteAction) conversationSwitchStartedRef.current = false;
    setMenuOpenId(null);
    requestAnimationFrame(() => menuButtonRefs.current.get(id)?.focus());
    startTransition(async () => {
      try {
        pendingLocateRef.current = fn === deleteAction ? null : id;
        await fn(id);
        setSummaryVersion((version) => version + 1);
        router.refresh();
        if (fn === deleteAction && !conversationSwitchStartedRef.current && window.location.pathname === `/chat/${id}`) router.replace("/chat");
      } catch (err) {
        pendingLocateRef.current = null;
        console.error("conversation action failed:", err);
      }
    });
  };

  const submitRename = async () => {
    const title = renameTitle.trim();
    if (!renameTarget || !title || renameSaving) return;
    const target = renameTarget;
    setRenameSaving(true);
    setRenameError(false);
    try {
      pendingLocateRef.current = target.id;
      await renameAction(target.id, title);
      setSummaryVersion((version) => version + 1);
      setNavigation((current) => ({
        ...current,
        conversations: current.conversations.map((item) => item.id === target.id ? { ...item, title } : item),
      }));
      setRenameTarget(null);
      router.refresh();
    } catch {
      pendingLocateRef.current = null;
      setRenameError(true);
    } finally {
      setRenameSaving(false);
    }
  };

  // 合并乐观新会话项。SSR 未带上时插入列表头;SSR 已命中同 id 时,用乐观项 title
  // 覆盖 SSR title —— SSR 的 title 可能停在 "新会话"(revalidatePath 重取早于
  // 后台 worker 写库),而乐观项 title 由会话标题短轮询刷新成 fallback / 真实摘要。
  // 新会话场景跳过 router.refresh(),SSR 不会自动追上,
  // 必须由乐观项 title 接管显示,直到整页刷新(store 重置、SSR 读 DB 最新值)。
  const allConversations = useMemo(() => {
    if (!optimisticConversation) return loadedConversations;
    const optTitle = optimisticConversation.title || newConversationText;
    if (loadedConversations.some((c) => c.id === optimisticConversation.id)) {
      return loadedConversations.map((c) =>
        c.id === optimisticConversation.id ? { ...c, title: optTitle } : c,
      );
    }
    return [
      {
        id: optimisticConversation.id,
        title: optTitle,
        pinned: false,
        archived: false,
        generating: generatingIds.has(optimisticConversation.id),
        updatedAt: optimisticConversation.createdAt,
        sortUpdatedAt: new Date(optimisticConversation.createdAt).toISOString().replace("Z", "000Z"),
        rank: 1,
      },
      ...loadedConversations,
    ].sort(compareConversations);
  }, [loadedConversations, optimisticConversation, newConversationText, generatingIds]);

  // 分组:置顶 / 今天 / 昨天 / 前天 / 周内 / 月内 / 更早 / 归档
  const groups = useMemo(() => {
    const result: Record<ConversationGroupKey, ConversationItem[]> = {
      pinned: [], today: [], yesterday: [], dayBeforeYesterday: [],
      withinWeek: [], withinMonth: [], earlier: [], archived: [],
    };
    for (const c of allConversations) {
      result[conversationGroupFor(c, boundaries)].push(c);
    }
    return result;
  }, [allConversations, boundaries]);

  const totals = new Map(groupSummary.map(({ key, total }) => [key, total]));
  const baseSections: { key: ConversationGroupKey; label: string; items: ConversationItem[] }[] = [
    { key: "pinned", label: groupPinnedText, items: groups.pinned },
    { key: "today", label: groupTodayText, items: groups.today },
    { key: "yesterday", label: groupYesterdayText, items: groups.yesterday },
    { key: "dayBeforeYesterday", label: groupDayBeforeYesterdayText, items: groups.dayBeforeYesterday },
    { key: "withinWeek", label: groupWithinWeekText, items: groups.withinWeek },
    { key: "withinMonth", label: groupWithinMonthText, items: groups.withinMonth },
    { key: "earlier", label: groupEarlierText, items: groups.earlier },
    { key: "archived", label: groupArchivedText, items: groups.archived },
  ];
  const sections = baseSections.map((section) => ({ ...section, total: totals.get(section.key) ?? section.items.length }))
    .filter((section) => section.total > 0);
  const groupHasMore = (section: (typeof sections)[number]) =>
    section.total > section.items.length && groupLoads[section.key]?.nextCursor !== null;

  const loadGroup = async (key: ConversationGroupKey, items: ConversationItem[]) => {
    if (groupLoads[key]?.loading) return;
    const request = (groupRequestRef.current[key] ?? 0) + 1;
    groupRequestRef.current[key] = request;
    const knownCursor = groupLoads[key]?.nextCursor;
    const cursor = knownCursor === undefined && items.length > 0
      ? encodeConversationGroupCursor(items.at(-1)!)
      : knownCursor;
    setGroupLoads((current) => ({ ...current, [key]: { ...current[key], loading: true, failed: false } }));
    if (!navigator.onLine) {
      setGroupLoads((current) => ({ ...current, [key]: { ...current[key], loading: false, failed: true } }));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const page = await Promise.race([
        loadGroupAction(key, boundaries, cursor),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 10_000); }),
      ]);
      if (groupRequestRef.current[key] !== request) return;
      setNavigation((current) => ({
        ...current,
        conversations: mergeConversations(current.conversations, page.items),
      }));
      setGroupLoads((current) => ({ ...current, [key]: { loading: false, failed: false, nextCursor: page.nextCursor } }));
    } catch {
      if (groupRequestRef.current[key] === request) {
        setGroupLoads((current) => ({ ...current, [key]: { ...current[key], loading: false, failed: true } }));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const toggleGroup = (key: ConversationGroupKey, items: ConversationItem[], total: number) => {
    const opening = collapsedGroups.has(key);
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (opening && total > items.length && groupLoads[key]?.nextCursor !== null) void loadGroup(key, items);
  };

  useEffect(() => {
    const id = pendingLocateRef.current;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
      pendingLocateRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [allConversations]);

  const openMobileSidebar = () => {
    setCollapsed(false);
    setIsOpen(true);
  };

  const renderItem = (c: ConversationItem) => {
    const isActive = c.id === activeConvId;
    const justCompleted = !isActive && completedIds.has(c.id);
    const handleClick = () => {
      if (!isActive) conversationSwitchStartedRef.current = true;
      setIsOpen(false);
      if (justCompleted) clearCompleted(c.id);
    };
    return (
    <div key={c.id} ref={(node) => { if (node) rowRefs.current.set(c.id, node); else rowRefs.current.delete(c.id); }} className="group relative">
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
          "inline-flex min-w-0 max-w-full w-full items-center gap-2 overflow-hidden rounded-md px-3 py-2 pr-8 text-ui-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue",
          isActive
            ? "bg-sora-blue/[0.08] text-neutral-900  font-semibold"
            : "text-neutral-600  hover:text-neutral-900  hover:bg-neutral-100 ",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{c.title}</span>
        {(c.generating || streamingConvIds.includes(c.id)) && <span className="relative ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-label={tSidebar("generating")}><span className="h-1.5 w-1.5 rounded-full bg-sora-blue" /><Loader2 className="absolute inset-0 h-4 w-4 animate-spin text-sora-blue motion-reduce:animate-none" aria-hidden="true" /></span>}
        {justCompleted && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-sora-blue" aria-label="有新回复" />}
      </Link>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
      <Popover
        open={menuOpenId === c.id}
        onClose={() => { setMenuOpenId(null); requestAnimationFrame(() => menuButtonRefs.current.get(c.id)?.focus()); }}
        align="right"
        panelClassName="w-40"
        panelZ="z-50"
        trigger={<button
          ref={(node) => { if (node) menuButtonRefs.current.set(c.id, node); else menuButtonRefs.current.delete(c.id); }}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpenId((cur) => (cur === c.id ? null : c.id));
          }}
          className={clsx("touch-target p-1 rounded text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-neutral-200 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue ", menuOpenId === c.id && "opacity-100")}
          aria-label={tSidebar("moreActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpenId === c.id}
        >
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>}
      >
          <div role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpenId(null); setRenameTarget(c); setRenameTitle(c.title); setRenameError(false); }} className="touch-target flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-ui-caption text-neutral-700 hover:bg-neutral-50  ">
              <Pencil className="h-3 w-3" aria-hidden="true" />
              <span>{actionRenameText}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAction(togglePinnedAction, c.id)}
              className="touch-target w-full text-left rounded px-2 py-1.5 text-ui-caption text-neutral-700  hover:bg-neutral-50  flex items-center gap-1.5 cursor-pointer"
            >
              <Pin className="w-3 h-3" aria-hidden="true" />
              <span>{c.pinned ? actionUnpinText : actionPinText}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAction(toggleArchivedAction, c.id)}
              className="touch-target w-full text-left rounded px-2 py-1.5 text-ui-caption text-neutral-700  hover:bg-neutral-50  flex items-center gap-1.5 cursor-pointer"
            >
              <Archive className="w-3 h-3" aria-hidden="true" />
              <span>{c.archived ? actionUnarchiveText : actionArchiveText}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (isPending) return;
                setMenuOpenId(null);
                setDeleteTargetId(c.id);
              }}
              className="touch-target w-full text-left rounded px-2 py-1.5 text-ui-caption text-danger hover:bg-red-50  flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              <span>{actionDeleteText}</span>
            </button>
          </div>
      </Popover>
      </div>
    </div>
    );
  };

  return (
    <>
      {/* Mobile sidebar trigger occupies ChatHeader's reserved leading space. */}
      <div
        aria-hidden={isOpen ? true : undefined}
        inert={isOpen ? true : undefined}
        className="fixed left-2 top-1.5 z-30 md:hidden"
      >
        <button
          type="button"
          onClick={openMobileSidebar}
          className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue   "
          aria-controls="chat-sidebar"
          aria-expanded={isOpen}
          aria-label={tNav("openSidebar")}
          title={tNav("openSidebar")}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

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
        aria-hidden={isMobile && !isOpen ? true : undefined}
        inert={isMobile && !isOpen ? true : undefined}
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex min-h-0 w-[min(18rem,calc(100vw-3rem))] max-w-72 shrink-0 flex-col border-r border-morning-mist bg-nebula-white p-4 transform transition-transform duration-200 ease-out   md:static md:z-40 md:h-screen md:translate-x-0 md:transition-[width,min-width,max-width,transform] md:duration-250 md:ease-in-out",
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
              className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
              aria-label="Nekusora"
            >
              <Image src="/icon.svg" alt="" width={42} height={42} className="brightness-0 " priority />
            </Link>
          </div>
          <div className="flex items-center gap-1">
            {!collapsed && (
              <button type="button" onClick={() => setSearchOpen(true)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  " aria-label={searchText} title={searchText}>
                <Search className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="touch-target hidden h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue md:inline-flex"
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            >
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue   md:hidden"
              aria-label={tNav("closeSidebar")}
              title={tNav("closeSidebar")}
            >
              <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav className={clsx("min-h-0 flex-1 flex-col items-center gap-1.5 pt-3", collapsed ? "hidden md:flex" : "hidden")} aria-label="快捷导航">
          <button type="button" onClick={handleNewConversation} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-800 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue   " aria-label={newConversationText} title={newConversationText}>
            <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setSearchOpen(true)} className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  " aria-label={searchText} title={searchText}>
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <Link href="/image" className="touch-target inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  " aria-label={imageText} title={imageText}>
            <ImageIcon className="h-[18px] w-[18px]" aria-hidden="true" />
          </Link>
        </nav>

        <div className={clsx("flex min-h-0 flex-1 flex-col", collapsed && "md:hidden")}>
          {/* New Conversation Button */}
          <button
            type="button"
            onClick={handleNewConversation}
            className="touch-target mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-morning-mist  hover:bg-neutral-50  px-3 py-2 text-ui-body font-semibold text-neutral-700  transition-[background-color,color,border-color,box-shadow] duration-150 ease-out shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
          >
            <Plus className="w-4 h-4 text-sora-blue" aria-hidden="true" />
            <span>{newConversationText}</span>
          </button>

        {/* 图像工作区入口 */}
        <Link
          href="/image"
          onClick={() => setIsOpen(false)}
          className="touch-target inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-ui-body font-medium text-neutral-500  hover:text-neutral-800  hover:bg-neutral-50  transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue"
        >
          <ImageIcon className="w-3.5 h-3.5 text-neutral-400 " aria-hidden="true" />
          <span>{imageText}</span>
        </Link>

        {/* Conversations List Label */}
        <div className="mt-3 px-3 py-1.5 text-ui-caption font-semibold text-ink-tertiary shrink-0 select-none">
          {conversationsText}
        </div>

        {/* Scrollable Conversation List */}
        <div className="scroll-fade-y flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
          {sections.length === 0 ? (
            <p className="text-ui-body text-ink-tertiary px-3 py-2">{noConversationsText}</p>
          ) : (
            <>
            {sections.map((section) => (
              <div key={section.key}>
                <button type="button" onClick={() => toggleGroup(section.key, section.items, section.total)} className="touch-target flex w-full items-center gap-2 px-3 py-2 text-ui-caption font-medium text-ink-tertiary hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue  " aria-expanded={!collapsedGroups.has(section.key)}>
                  <span>{section.label}</span>
                  <span className="h-px min-w-4 flex-1 bg-morning-mist/80 " aria-hidden="true" />
                  <span className="text-ink-tertiary">{section.total}</span>
                  <ChevronDown className={clsx("h-3 w-3 transition-transform", collapsedGroups.has(section.key) && "-rotate-90")} aria-hidden="true" />
                </button>
                {!collapsedGroups.has(section.key) && <div className="space-y-0.5">
                  {section.items.map(renderItem)}
                  {groupHasMore(section) && (
                    <button type="button" onClick={() => void loadGroup(section.key, section.items)} disabled={groupLoads[section.key]?.loading} aria-busy={groupLoads[section.key]?.loading} className="touch-target flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-ui-caption font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sora-blue">
                      {groupLoads[section.key]?.loading && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      {groupLoads[section.key]?.failed ? tSidebar("loadMoreRetry") : groupLoads[section.key]?.loading ? tSidebar("loadingMore") : tSidebar("loadMore")}
                    </button>
                  )}
                </div>}
              </div>
            ))}
            </>
          )}
        </div>

        </div>

        {/* Footer user menu */}
        <div ref={userMenuRef} className="relative pt-3 mt-2 border-t border-morning-mist  shrink-0">
          {userMenuOpen && (
            <div className={clsx("absolute bottom-full left-0 right-0 z-30 mb-2 rounded-lg border border-morning-mist bg-white p-1 shadow-lg  ", collapsed && "md:bottom-0 md:left-full md:right-auto md:mb-0 md:ml-2 md:w-48")}>
              <Link href="/panel" onClick={() => { setUserMenuOpen(false); setIsOpen(false); }} className="touch-target flex items-center gap-2 rounded-md px-3 py-2 text-ui-body text-neutral-700 hover:bg-neutral-100  ">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                {settingsText}
              </Link>
              <form onSubmit={handleSignOut}>
                <button type="submit" disabled={isPending} className="touch-target flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-ui-body text-danger hover:bg-red-50 disabled:opacity-50 ">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {logoutText}
                </button>
              </form>
            </div>
          )}
          <button type="button" onClick={() => setUserMenuOpen((value) => !value)} className={clsx("touch-target flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-neutral-100  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue", collapsed && "md:justify-center")} aria-expanded={userMenuOpen}>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sora-blue/10 text-ui-caption font-semibold text-sora-blue">{displayName.slice(0, 1).toUpperCase()}</span>
            <span className={clsx("min-w-0 flex-1", collapsed && "md:hidden")}><span className="block truncate text-ui-body font-semibold text-neutral-800 ">{displayName}</span><span className="mt-0.5 block truncate text-ui-caption font-mono text-ink-tertiary ">{userEmail}</span></span>
            <ChevronDown className={clsx("h-4 w-4 shrink-0 text-neutral-400 transition-transform", userMenuOpen && "rotate-180", collapsed && "md:hidden")} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title={actionDeleteText}
        message={deleteConfirmText}
        confirmLabel={actionDeleteText}
        cancelLabel={tCommon("cancel")}
        onConfirm={() => {
          if (deleteTargetId) runAction(deleteAction, deleteTargetId);
        }}
      />

      <Modal open={renameTarget !== null} onClose={() => { if (!renameSaving) setRenameTarget(null); }} title={actionRenameText} dialogClassName="m-auto w-[min(420px,92vw)] rounded-lg border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40">
        <form onSubmit={(event) => { event.preventDefault(); void submitRename(); }} className="space-y-4">
          <input autoFocus value={renameTitle} onChange={(event) => { setRenameTitle(event.target.value); setRenameError(false); }} maxLength={200} aria-label={actionRenameText} aria-invalid={renameError} className="w-full rounded-md border border-morning-mist bg-white px-3 py-2 text-ui-body text-space-ink focus:border-sora-blue focus:outline-none focus:ring-2 focus:ring-sora-blue/20" />
          {renameError && <p role="alert" className="text-ui-caption text-danger">{tSidebar("renameFailed")}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenameTarget(null)} disabled={renameSaving} className="touch-target rounded-md px-3 py-2 text-ui-body text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">{tCommon("cancel")}</button>
            <Button type="submit" variant="primary" loading={renameSaving} disabled={!renameTitle.trim()} className="px-3 py-2">{renameSaveText}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title={searchText} dialogClassName="m-auto w-[min(720px,92vw)] rounded-xl border border-morning-mist bg-white p-0 text-space-ink shadow-xl backdrop:bg-black/40   ">
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchText} aria-label={searchText} className="w-full rounded-lg border border-morning-mist bg-white py-3 pl-10 pr-3 text-ui-body text-space-ink outline-none focus:border-sora-blue   " />
          </div>
          <div className="scroll-fade-y max-h-[min(55vh,460px)] overflow-y-auto">
            {!query.trim() ? <p className="py-8 text-center text-ui-body text-ink-tertiary">{searchText}</p> : searching ? <p className="flex items-center justify-center gap-2 py-8 text-ui-body text-ink-tertiary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{tSidebar("searching")}</p> : searchResults.length === 0 ? <p className="py-8 text-center text-ui-body text-ink-tertiary">{tSidebar("noSearchResults")}</p> : <div className="space-y-1">{searchResults.map((r) => <Link key={`${r.conversationId}-${r.messagePublicId}-${r.createdAt}`} href={`/chat/${r.conversationId}`} onClick={() => { if (r.conversationId !== activeConvId) conversationSwitchStartedRef.current = true; setSearchOpen(false); }} className="block rounded-lg px-3 py-3 hover:bg-neutral-100 "><div className="truncate text-ui-body font-medium">{r.conversationTitle}</div><div className="mt-1 line-clamp-2 text-ui-caption text-neutral-500 ">{highlightSnippet(r.snippet, query.trim())}</div></Link>)}</div>}
          </div>
        </div>
      </Modal>
    </>
  );
}
