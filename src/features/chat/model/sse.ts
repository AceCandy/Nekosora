/**
 * SSE 流消费器 —— 解析 /api/chat 的流式响应,分发 delta/error/trace 事件。
 *
 * 抽离自 ChatComposer 的 send/regenerate 两处重复的 reader 循环。
 * 纯异步函数,无 React 依赖,便于单测。
 *
 * SSE 帧格式(见 /api/chat route):
 *   data: {"type":"delta","text":"..."}
 *   data: {"type":"error","error":"..."}
 *   data: {"type":"trace","trace":{...}}
 *   data: [DONE]
 */
export interface SSEEvent {
  type: "delta" | "error" | "trace";
  text?: string;
  error?: string;
  trace?: {
    totalTokenEstimate?: number;
    sentMessageCount?: number;
    blocks?: { kind: string; title?: string; tokenEstimate?: number }[];
  };
}

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onError?: (error: string) => void;
  onTrace?: (trace: SSEEvent["trace"]) => void;
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
        if (data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data) as SSEEvent;
          if (ev.type === "delta" && ev.text !== undefined) {
            handlers.onDelta(ev.text);
          } else if (ev.type === "error" && ev.error !== undefined) {
            handlers.onError?.(ev.error);
          } else if (ev.type === "trace" && ev.trace !== undefined) {
            handlers.onTrace?.(ev.trace);
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
  return { content: `[错误] ${msg}`, aborted: false };
}
