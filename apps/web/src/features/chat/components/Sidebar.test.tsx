import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effects: [] as { run: React.EffectCallback; deps: React.DependencyList | undefined }[],
  refresh: vi.fn(),
  runtimes: {} as Record<string, { streaming: boolean }>,
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof React>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) {
      harness.states[index] = typeof initial === "function" ? initial() : initial;
    }
    return [harness.states[index], (next: unknown) => {
      harness.states[index] = typeof next === "function" ? next(harness.states[index]) : next;
    }];
  },
  useMemo: (get: () => unknown) => get(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useTransition: () => [false, vi.fn()],
  useEffect: (run: React.EffectCallback, deps?: React.DependencyList) => harness.effects.push({ run, deps }),
  useLayoutEffect: () => {},
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ refresh: harness.refresh }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("zustand/react/shallow", () => ({ useShallow: (select: unknown) => select }));
vi.mock("@/features/chat/actions/conversations", () => ({ getConversationPreview: vi.fn(), searchMessages: vi.fn() }));
vi.mock("@/shared/components/ChangePasswordDialog", () => ({ default: () => null }));
vi.mock("@/shared/ui/UnsavedChangesDialog", () => ({
  default: () => null,
  useUnsavedChanges: () => ({ contentRef: { current: null }, requestClose: vi.fn(), dialogProps: {} }),
}));
vi.mock("@/features/chat/store/chatStreamStore", () => ({
  useChatStreamStore: (select: (state: { runtimes: typeof harness.runtimes; activeConversationId: string }) => unknown) =>
    select({ runtimes: harness.runtimes, activeConversationId: "new-conversation" }),
}));

import Sidebar from "./Sidebar";

function props(initialGeneratingIds: string[]): React.ComponentProps<typeof Sidebar> {
  return {
    userName: "test", userEmail: "test@example.invalid", conversations: [], nextCursor: null, initialGeneratingIds,
    newConversationText: "new", conversationsText: "conversations", noConversationsText: "empty",
    settingsText: "settings", logoutText: "logout", groupPinnedText: "pinned", groupTodayText: "today",
    groupYesterdayText: "yesterday", groupDayBeforeYesterdayText: "before", groupWithinWeekText: "week",
    groupWithinMonthText: "month", groupEarlierText: "earlier", groupArchivedText: "archived",
    searchText: "search", imageText: "image", actionPinText: "pin", actionUnpinText: "unpin",
    actionArchiveText: "archive", actionUnarchiveText: "unarchive", actionDeleteText: "delete",
    actionRenameText: "rename", renameSaveText: "save", deleteConfirmText: "confirm",
    signOutAction: vi.fn(), togglePinnedAction: vi.fn(), toggleArchivedAction: vi.fn(), deleteAction: vi.fn(),
    renameAction: vi.fn(), getGroupSummaryAction: vi.fn(), loadGroupAction: vi.fn(), getConversationAction: vi.fn(),
    getGeneratingStatusesAction: vi.fn().mockResolvedValue([]),
  };
}

// 只执行真实 Sidebar 的轮询 effect；其余 DOM/快捷键 effect 不属于本测试。
function renderPolling(input: React.ComponentProps<typeof Sidebar>) {
  harness.cursor = 0;
  harness.effects = [];
  Sidebar(input);
  const effect = harness.effects.find(({ deps }) => deps?.includes(input.getGeneratingStatusesAction));
  expect(effect).toBeDefined();
  return effect!.run();
}

describe("Sidebar generating polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    harness.states = [];
    harness.runtimes = {};
  });
  afterEach(() => vi.useRealTimers());

  it("does not refresh the new-conversation page while the server run is not visible yet", async () => {
    harness.runtimes = { "new-conversation": { streaming: true } };
    const input = props([]);
    const cleanup = renderPolling(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(input.getGeneratingStatusesAction).toHaveBeenCalledTimes(1);
    expect(harness.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(input.getGeneratingStatusesAction).toHaveBeenCalledTimes(2);
    cleanup?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a completed server run without reviving it from stale SSR props", async () => {
    const input = props(["background"]);
    const cleanup = renderPolling(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.refresh).not.toHaveBeenCalled();
    cleanup?.();
    renderPolling(input);
    await vi.advanceTimersByTimeAsync(12000);
    expect(input.getGeneratingStatusesAction).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a failed poll and cancels the retry on cleanup", async () => {
    const input = props(["background"]);
    vi.mocked(input.getGeneratingStatusesAction).mockRejectedValueOnce(new Error("offline"));
    const cleanup = renderPolling(input);
    await vi.advanceTimersByTimeAsync(6000);
    expect(input.getGeneratingStatusesAction).toHaveBeenCalledTimes(2);
    expect(harness.refresh).not.toHaveBeenCalled();
    cleanup?.();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("adopts generating ids from a fresh navigation snapshot", async () => {
    const input = props([]);
    renderPolling(input);
    const next = { ...input, conversations: [], initialGeneratingIds: ["remote-run"] };
    renderPolling(next);
    const cleanup = renderPolling(next);
    await vi.advanceTimersByTimeAsync(0);
    expect(input.getGeneratingStatusesAction).toHaveBeenCalledTimes(1);
    expect(harness.refresh).not.toHaveBeenCalled();
    cleanup?.();
  });
});
