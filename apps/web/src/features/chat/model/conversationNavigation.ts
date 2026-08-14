export const CONVERSATION_PAGE_SIZE = 30;
export const CONVERSATION_GROUP_PAGE_SIZE = 20;

export const CONVERSATION_GROUP_KEYS = [
  "pinned", "today", "yesterday", "dayBeforeYesterday",
  "withinWeek", "withinMonth", "earlier", "archived",
] as const;

export type ConversationGroupKey = (typeof CONVERSATION_GROUP_KEYS)[number];

export interface ConversationGroupBoundaries {
  todayStart: string;
  yesterdayStart: string;
  dayBeforeYesterdayStart: string;
  sevenDaysAgoStart: string;
  thirtyDaysAgoStart: string;
}

export interface ConversationGroupSummary {
  key: ConversationGroupKey;
  total: number;
}

export interface ConversationNavigationItem {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  generating: boolean;
  updatedAt: number;
  sortUpdatedAt: string;
  rank: number;
}

export interface ConversationNavigationPage {
  items: ConversationNavigationItem[];
  nextCursor: string | null;
}

export interface ConversationGroupPage extends ConversationNavigationPage {
  key: ConversationGroupKey;
}

export function createConversationGroupBoundaries(now = new Date()): ConversationGroupBoundaries {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const boundary = (daysAgo: number) => {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  };
  return {
    todayStart: today.toISOString(),
    yesterdayStart: boundary(1),
    dayBeforeYesterdayStart: boundary(2),
    sevenDaysAgoStart: boundary(7),
    thirtyDaysAgoStart: boundary(30),
  };
}

export function conversationGroupFor(
  item: Pick<ConversationNavigationItem, "pinned" | "archived" | "updatedAt">,
  boundaries: ConversationGroupBoundaries,
): ConversationGroupKey {
  if (item.archived) return "archived";
  if (item.pinned) return "pinned";
  if (item.updatedAt >= Date.parse(boundaries.todayStart)) return "today";
  if (item.updatedAt >= Date.parse(boundaries.yesterdayStart)) return "yesterday";
  if (item.updatedAt >= Date.parse(boundaries.dayBeforeYesterdayStart)) return "dayBeforeYesterday";
  if (item.updatedAt >= Date.parse(boundaries.sevenDaysAgoStart)) return "withinWeek";
  if (item.updatedAt >= Date.parse(boundaries.thirtyDaysAgoStart)) return "withinMonth";
  return "earlier";
}

export function encodeConversationGroupCursor(
  item: Pick<ConversationNavigationItem, "sortUpdatedAt" | "id">,
): string {
  const json = JSON.stringify({ updatedAt: item.sortUpdatedAt, id: item.id });
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function compareConversations(
  a: ConversationNavigationItem,
  b: ConversationNavigationItem,
): number {
  return a.rank - b.rank
    || (a.sortUpdatedAt < b.sortUpdatedAt ? 1 : a.sortUpdatedAt > b.sortUpdatedAt ? -1 : 0)
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function mergeConversations(
  current: ConversationNavigationItem[],
  incoming: ConversationNavigationItem[],
): ConversationNavigationItem[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, item));
  return [...merged.values()].sort(compareConversations);
}

export function mergeConversationIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort();
}
