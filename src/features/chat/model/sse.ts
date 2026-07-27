/**
 * SSE 流消费器 —— 解析 /api/chat 的流式响应,分发文本与终态事件。
 *
 * 抽离自 ChatComposer 的 send/regenerate 两处重复的 reader 循环。
 * 纯异步函数,无 React 依赖,便于单测。
 *
 * SSE 帧格式(见 /api/chat route):
 *   data: {"type":"user_message","publicId":"..."}       (本轮 user 消息稳定标识,最先发送)
 *   data: {"type":"assistant_message","publicId":"..."}  (本轮 assistant 占位消息稳定标识)
 *   data: {"type":"delta","text":"..."}
 *   data: {"type":"reasoning","text":"..."}
 *   data: {"type":"tool_call","toolName":"...","args":{...}}
 *   data: {"type":"tool_result","toolName":"...","isError":false}
 *   data: {"type":"search_result","results":[{"title":"...","url":"...","snippet":"..."}]}
 *   data: {"type":"error","error":"..."}
 *   data: {"type":"finish","metadata":{...}}
 *   data: {"type":"title_updated","title":"...","conversationId":"..."}
 *   data: [DONE]
 */
import type { MessageRunMetadata } from "@/features/chat/model/types";

export interface SSEEvent {
  type:
    | "user_message"
    | "assistant_message"
    | "delta"
    | "reasoning"
    | "tool_call"
    | "tool_result"
    | "search_result"
    | "error"
    | "finish"
    | "title_updated";
  text?: string;
  toolName?: string;
  args?: unknown;
  isError?: boolean;
  results?: { title: string; url: string; snippet: string }[];
  error?: string;
  metadata?: MessageRunMetadata;
  /** title_updated:会话自动生成的新标题。 */
  title?: string;
  /** title_updated:对应的会话 ID。 */
  conversationId?: string;
  /** user_message / assistant_message:对应消息的稳定标识(供前端回填)。 */
  publicId?: string;
}

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, isError: boolean) => void;
  onSearchResult?: (results: { title: string; url: string; snippet: string }[]) => void;
  onError?: (error: string) => void;
  onFinish?: (metadata: MessageRunMetadata) => void;
  /** 会话标题自动生成完成后触发(用于刷新侧栏会话列表)。 */
  onTitleUpdated?: (title: string, conversationId: string) => void;
  /** 收到本轮 user 消息的稳定标识(供前端回填后支持编辑重发)。 */
  onUserMessage?: (publicId: string) => void;
  /** 收到本轮 assistant 占位消息的稳定标识(供前端回填,无需刷新即可显示操作按钮)。 */
  onAssistantMessage?: (publicId: string) => void;
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
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行切分,最后一段可能不完整,留到下次拼接。
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        // 服务端保证 DONE 仅在 assistant 与必要会话状态持久化后发送。
        if (data === "[DONE]") return;
        try {
          const ev = JSON.parse(data) as SSEEvent;
          if (ev.type === "delta" && ev.text !== undefined) {
            handlers.onDelta(ev.text);
          } else if (ev.type === "reasoning" && ev.text !== undefined) {
            handlers.onReasoning?.(ev.text);
          } else if (ev.type === "tool_call" && ev.toolName !== undefined) {
            handlers.onToolCall?.(ev.toolName, ev.args);
          } else if (ev.type === "tool_result" && ev.toolName !== undefined) {
            handlers.onToolResult?.(ev.toolName, ev.isError ?? false);
          } else if (ev.type === "search_result" && ev.results !== undefined) {
            handlers.onSearchResult?.(ev.results);
          } else if (ev.type === "error" && ev.error !== undefined) {
            handlers.onError?.(ev.error);
          } else if (ev.type === "finish" && ev.metadata !== undefined) {
            handlers.onFinish?.(ev.metadata);
          } else if (ev.type === "title_updated" && ev.title !== undefined && ev.conversationId !== undefined) {
            handlers.onTitleUpdated?.(ev.title, ev.conversationId);
          } else if (ev.type === "user_message" && ev.publicId !== undefined) {
            handlers.onUserMessage?.(ev.publicId);
          } else if (ev.type === "assistant_message" && ev.publicId !== undefined) {
            handlers.onAssistantMessage?.(ev.publicId);
          }
        } catch {
          /* ignore parse errors */
        }
      }
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
