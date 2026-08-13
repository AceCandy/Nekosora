export const CONVERSATION_PAGE_SIZE = 30;

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
