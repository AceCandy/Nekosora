const NEW_CONVERSATION_PARAM = "new";
const DEFAULT_NEW_CONVERSATION_KEY = "__new__";

/** 为每次“新对话”命令生成可强制重挂 ChatComposer 的 URL。 */
export function newConversationHref(resetKey: string): string {
  return `/chat?${NEW_CONVERSATION_PARAM}=${encodeURIComponent(resetKey)}`;
}

/** 从新对话页参数中读取本次 ChatComposer 实例键。 */
export function newConversationKey(searchParams: Record<string, string | string[] | undefined>): string {
  const value = searchParams[NEW_CONVERSATION_PARAM];
  return typeof value === "string" && value ? value : DEFAULT_NEW_CONVERSATION_KEY;
}
