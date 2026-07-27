export const CHAT_SCROLL_EDGE_THRESHOLD = 24;

export interface ChatScrollMemoryEntry {
  scrollTop: number;
  atEnd: boolean;
}

interface ChatScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export type ChatScrollEntryAction =
  | { kind: "follow-end" }
  | { kind: "restore"; scrollTop: number };

export function captureChatScrollMemory(metrics: ChatScrollMetrics): ChatScrollMemoryEntry {
  return {
    scrollTop: metrics.scrollTop,
    atEnd:
      metrics.scrollTop + metrics.clientHeight >=
      metrics.scrollHeight - CHAT_SCROLL_EDGE_THRESHOLD,
  };
}

export function resolveChatScrollEntry(memory: ChatScrollMemoryEntry | undefined): ChatScrollEntryAction {
  return memory && !memory.atEnd
    ? { kind: "restore", scrollTop: memory.scrollTop }
    : { kind: "follow-end" };
}
