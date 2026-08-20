export const USER_MESSAGE_BUBBLE_CLASS =
  "relative rounded-2xl bg-neutral-900 text-white px-4 py-2.5   shadow-none border border-transparent text-ui-reading leading-7 whitespace-pre-wrap [overflow-wrap:anywhere] overflow-hidden";

export const ASSISTANT_MESSAGE_CLASS =
  "text-neutral-800  text-ui-reading leading-7";

export function splitChatError(content: string): { body: string; error: string | null } {
  const match = content.match(/(?:^|\n\n)(\[错误\][\s\S]*)$/);
  if (!match) return { body: content, error: null };
  return { body: content.slice(0, match.index).trimEnd(), error: match[1] };
}
