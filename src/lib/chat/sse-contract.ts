export const CHAT_TERMINAL_STATUSES = [
  "success",
  "failed",
  "interrupted",
] as const;

/** 认证 Chat SSE 在业务事实提交后的显式终态。 */
export type ChatTerminalStatus = (typeof CHAT_TERMINAL_STATUSES)[number];

export interface ChatTerminalEvent {
  type: "terminal";
  status: ChatTerminalStatus;
}

export function isChatTerminalStatus(value: unknown): value is ChatTerminalStatus {
  return typeof value === "string"
    && (CHAT_TERMINAL_STATUSES as readonly string[]).includes(value);
}
