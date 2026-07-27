import type { MessageVersionSelections } from "@/db/types";

export interface VisibleBranchResult {
  messages: Record<string, unknown>[];
  versionMap: Record<string, { current: number; total: number }>;
}

const ROOT_SIBLING_KEY = "__root__";

/** 从有序消息树解析当前主线，并应用已持久化的 assistant 版本选择。 */
export function resolveVisibleBranch(
  allMessages: Record<string, unknown>[],
  selections: MessageVersionSelections | null | undefined,
): VisibleBranchResult {
  if (allMessages.length === 0) return { messages: [], versionMap: {} };

  const parentIds = new Set(
    allMessages.map((message) => message.parentId as string | null).filter((id): id is string => Boolean(id)),
  );
  const leaves = allMessages.filter((message) => !parentIds.has(message.id as string));
  const latest = (leaves.length > 0 ? leaves : allMessages).reduce((left, right) =>
    new Date(right.createdAt as string | Date).getTime() > new Date(left.createdAt as string | Date).getTime()
      ? right
      : left,
  );

  const byId = new Map(allMessages.map((message) => [message.id as string, message]));
  const mainLineIds = new Set<string>();
  let cursor: string | null = latest.id as string;
  while (cursor && !mainLineIds.has(cursor)) {
    mainLineIds.add(cursor);
    cursor = (byId.get(cursor)?.parentId as string | null) ?? null;
  }

  const siblingsByParent = new Map<string, Record<string, unknown>[]>();
  for (const message of allMessages) {
    if (message.role !== "assistant") continue;
    const key = (message.parentId as string | null) ?? ROOT_SIBLING_KEY;
    const siblings = siblingsByParent.get(key) ?? [];
    siblings.push(message);
    siblingsByParent.set(key, siblings);
  }

  const versionMap: VisibleBranchResult["versionMap"] = {};
  const messages = allMessages
    .filter((message) => mainLineIds.has(message.id as string))
    .map((message) => {
      if (message.role !== "assistant") return message;
      const key = (message.parentId as string | null) ?? ROOT_SIBLING_KEY;
      const siblings = siblingsByParent.get(key) ?? [message];
      const selectedPublicId = selections?.[key];
      const selected = selectedPublicId
        ? siblings.find((candidate) => candidate.publicId === selectedPublicId)
        : undefined;
      const visible = selected ?? message;
      if (siblings.length > 1) {
        versionMap[visible.id as string] = {
          current: siblings.findIndex((candidate) => candidate.id === visible.id) + 1,
          total: siblings.length,
        };
      }
      return visible;
    });

  return { messages, versionMap };
}
