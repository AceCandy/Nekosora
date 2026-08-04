/**
 * SSE 流消费器 —— 解析 /api/chat 的流式响应,分发文本与终态事件。
 *
 * 抽离自 ChatComposer 的 send/regenerate 两处重复的 reader 循环。
 * 纯异步函数,无 React 依赖,便于单测。
 *
 * SSE 帧格式(见 /api/chat route):
 *   data: {"type":"user_message","publicId":"...","createdAt":"..."}       (本轮 user 消息身份)
 *   data: {"type":"assistant_message","publicId":"...","createdAt":"..."}  (本轮 assistant 消息身份)
 *   data: {"type":"delta","text":"..."}
 *   data: {"type":"reasoning","text":"..."}
 *   data: {"type":"tool_call","toolName":"...","args":{...}}
 *   data: {"type":"tool_result","toolName":"...","isError":false}
 *   data: {"type":"search_started","toolCallId":"...","query":"..."}
 *   data: {"type":"search_completed","toolCallId":"...","backend":{...},"citations":[...]}
 *   data: {"type":"search_failed","toolCallId":"...","reason":"..."}
 *   data: {"type":"search_result","results":[{"title":"...","url":"...","snippet":"..."}]}
 *   data: {"type":"error","error":"..."}
 *   data: {"type":"finish","metadata":{...}}
 *   data: {"type":"terminal","status":"success|failed|interrupted"}
 *   data: {"type":"title_updated","title":"...","conversationId":"..."}
 *   data: [DONE]
 */
import type { MessageRunMetadata } from "@/features/chat/model/types";
import type { WebSearchTraceBackend, WebSearchTraceCitation } from "@/db/types";
import {
  isChatTerminalStatus,
  type ChatTerminalEvent,
  type ChatTerminalStatus,
} from "@/lib/chat/sse-contract";

export interface SSEEvent {
  type:
    | "user_message"
    | "assistant_message"
    | "delta"
    | "reasoning"
    | "tool_call"
    | "tool_result"
    | "search_started"
    | "search_completed"
    | "search_failed"
    | "search_result"
    | "error"
    | "finish"
    | ChatTerminalEvent["type"]
    | "title_updated";
  text?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  isError?: boolean;
  results?: WebSearchTraceCitation[];
  query?: string;
  citations?: WebSearchTraceCitation[];
  backend?: WebSearchTraceBackend;
  reason?: string;
  error?: string;
  metadata?: MessageRunMetadata;
  status?: unknown;
  /** title_updated:会话自动生成的新标题。 */
  title?: string;
  /** title_updated:对应的会话 ID。 */
  conversationId?: string;
  /** user_message / assistant_message:对应消息的稳定标识(供前端回填)。 */
  publicId?: string;
  /** user_message / assistant_message:对应消息的绝对创建时间。 */
  createdAt?: string;
}

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (toolName: string, args: unknown, toolCallId?: string) => void;
  onToolResult?: (toolName: string, isError: boolean, toolCallId?: string) => void;
  onSearchStarted?: (toolCallId: string, query: string) => void;
  onSearchCompleted?: (
    toolCallId: string,
    citations: WebSearchTraceCitation[],
    backend?: WebSearchTraceBackend,
  ) => void;
  onSearchFailed?: (toolCallId: string, reason: string) => void;
  onSearchResult?: (results: WebSearchTraceCitation[]) => void;
  onError?: (error: string) => void;
  onFinish?: (metadata: MessageRunMetadata) => void;
  /** 会话标题自动生成完成后触发(用于刷新侧栏会话列表)。 */
  onTitleUpdated?: (title: string, conversationId: string) => void;
  /** 收到本轮 user 消息的稳定标识(供前端回填后支持编辑重发)。 */
  onUserMessage?: (publicId: string, createdAt?: string) => void;
  /** 收到本轮 assistant 占位消息的稳定标识(供前端回填,无需刷新即可显示操作按钮)。 */
  onAssistantMessage?: (publicId: string, createdAt?: string) => void;
}

/**
 * 从 ReadableStream<Uint8Array> 消费 SSE 帧,按行解析并回调。
 *
 * @param body 流响应体(已通过 res.body 获取)
 * @param handlers 事件回调
 * @throws AbortError 当上层 fetch 被 abort 时,reader.read() 抛出
 */
export async function consumeChatSSE(
  body: ReadableStream<Uint8Array>,
  handlers: SSEHandlers,
): Promise<ChatTerminalStatus> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishSeen = false;
  let terminalStatus: ChatTerminalStatus | null = null;

  const consumeLine = (line: string): ChatTerminalStatus | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) return null;
    const data = trimmed.slice(6);
    if (data === "[DONE]") {
      if (!terminalStatus) throw new Error("Chat SSE 缺少显式终态");
      if (terminalStatus === "success" && !finishSeen) {
        throw new Error("Chat SSE success 终态缺少 finish");
      }
      return terminalStatus;
    }

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return null;
    }
    if (!event || typeof event !== "object" || !("type" in event)) return null;
    const ev = event as SSEEvent;
    if (ev.type === "terminal") {
      if (terminalStatus) throw new Error("Chat SSE 收到重复 terminal");
      if (!isChatTerminalStatus(ev.status)) {
        throw new Error("Chat SSE terminal status 非法");
      }
      if (finishSeen && ev.status !== "success") {
        throw new Error("Chat SSE finish 与 terminal 状态冲突");
      }
      terminalStatus = ev.status;
      return null;
    }
    if (terminalStatus) throw new Error("Chat SSE terminal 后仍有业务事件");

    if (ev.type === "delta" && ev.text !== undefined) {
      handlers.onDelta(ev.text);
    } else if (ev.type === "reasoning" && ev.text !== undefined) {
      handlers.onReasoning?.(ev.text);
    } else if (ev.type === "tool_call" && ev.toolName !== undefined) {
      handlers.onToolCall?.(ev.toolName, ev.args, ev.toolCallId);
    } else if (ev.type === "tool_result" && ev.toolName !== undefined) {
      handlers.onToolResult?.(ev.toolName, ev.isError ?? false, ev.toolCallId);
    } else if (ev.type === "search_started" && ev.toolCallId !== undefined && ev.query !== undefined) {
      handlers.onSearchStarted?.(ev.toolCallId, ev.query);
    } else if (ev.type === "search_completed" && ev.toolCallId !== undefined && ev.citations !== undefined) {
      if (ev.backend) handlers.onSearchCompleted?.(ev.toolCallId, ev.citations, ev.backend);
      else handlers.onSearchCompleted?.(ev.toolCallId, ev.citations);
    } else if (ev.type === "search_failed" && ev.toolCallId !== undefined && ev.reason !== undefined) {
      handlers.onSearchFailed?.(ev.toolCallId, ev.reason);
    } else if (ev.type === "search_result" && ev.results !== undefined) {
      handlers.onSearchResult?.(ev.results);
    } else if (ev.type === "error" && ev.error !== undefined) {
      handlers.onError?.(ev.error);
    } else if (ev.type === "finish" && ev.metadata !== undefined) {
      finishSeen = true;
      handlers.onFinish?.(ev.metadata);
    } else if (ev.type === "title_updated" && ev.title !== undefined && ev.conversationId !== undefined) {
      handlers.onTitleUpdated?.(ev.title, ev.conversationId);
    } else if (ev.type === "user_message" && ev.publicId !== undefined) {
      handlers.onUserMessage?.(ev.publicId, ev.createdAt);
    } else if (ev.type === "assistant_message" && ev.publicId !== undefined) {
      handlers.onAssistantMessage?.(ev.publicId, ev.createdAt);
    }
    return null;
  };

  const consumeBufferedLines = (flush: boolean): ChatTerminalStatus | null => {
    const lines = buffer.split("\n");
    buffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const result = consumeLine(line);
      if (result) return result;
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const result = consumeBufferedLines(true);
        if (result) return result;
        throw new Error("Chat SSE 在 [DONE] 前结束");
      }
      buffer += decoder.decode(value, { stream: true });
      const result = consumeBufferedLines(false);
      if (result) return result;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 统一处理流式请求的错误:
 *   - AbortError → 追加「已停止生成」标记
 *   - 其他错误 → 设置错误内容
 *
 * @returns 是否为 abort 错误(决定是否追加标记文案)
 */
export function handleStreamError(
  err: unknown,
  fallbackMessage: string,
): { content: string; aborted: boolean } {
  if (err instanceof Error && err.name === "AbortError") {
    return { content: "\n\n[已停止生成]", aborted: true };
  }
  const msg = err instanceof Error ? err.message : fallbackMessage;
  return { content: `\n\n[错误] ${msg}`, aborted: false };
}
