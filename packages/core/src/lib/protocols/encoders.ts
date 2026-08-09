import { streamChat } from "@/lib/stream";
import { getGatewayUA } from "@/lib/system-settings/ua";
import {
  ERROR_META,
  ErrorCode,
  errorResponse,
  routingCodeToErrorCode,
  type ErrorCodeValue,
} from "@/lib/errors";
import type { CallContext, IRRequest, IRUsage, StreamEvent } from "@/lib/providers/types";
import { redactErrorMessage } from "@/lib/redaction";
import type { GatewayProtocol } from "./types";

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
}

interface CollectedResponse {
  text: string;
  reasoning: string;
  tools: ToolCallState[];
  finishReason: string;
  usage: IRUsage;
  error?: { code: ErrorCodeValue; message: string; details?: Record<string, unknown> };
}

type SupportedFinishReason = "stop" | "length" | "tool-calls" | "content-filter";

function isSupportedFinishReason(reason: string): reason is SupportedFinishReason {
  return reason === "stop"
    || reason === "length"
    || reason === "tool-calls"
    || reason === "content-filter";
}

function mergeUsage(current: IRUsage, next: IRUsage): IRUsage {
  return { ...current, ...next };
}

function unknownFinishMessage(reason: string): string {
  return `Unknown finish reason: '${reason}'.`;
}

function normalizeErrorCode(code?: string): ErrorCodeValue {
  if (code && code in ERROR_META) return code as ErrorCodeValue;
  if (code) {
    const routed = routingCodeToErrorCode(code);
    if (routed !== ErrorCode.SERVER_INTERNAL) return routed;
  }
  return ErrorCode.GATEWAY_GENERATION_FAILED;
}

/** 同一内部错误按入口协议包装，status 始终来自 ERROR_META。 */
export function protocolErrorResponse(
  protocol: GatewayProtocol,
  code: ErrorCodeValue,
  message?: string,
  details?: Record<string, unknown>,
): Response {
  const meta = ERROR_META[code];
  const standard = errorResponse(code, details, message).error;
  const parameter = typeof details?.parameter === "string" ? details.parameter : undefined;
  if (protocol === "anthropic") {
    return Response.json({
      type: "error",
      error: { type: standard.type, message: standard.message },
    }, { status: meta.status });
  }
  if (protocol === "gemini") {
    return Response.json({
      error: {
        code: meta.status,
        message: standard.message,
        status: meta.status === 400 ? "INVALID_ARGUMENT" : meta.status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
      },
    }, { status: meta.status });
  }
  return Response.json({
    error: {
      message: standard.message,
      type: standard.type,
      param: parameter ?? null,
      code,
    },
  }, { status: meta.status });
}

function usageOpenAI(usage: IRUsage) {
  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
    ...(usage.reasoningTokens !== undefined
      ? { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }
      : {}),
    ...(usage.cachedInputTokens !== undefined
      ? { prompt_tokens_details: { cached_tokens: usage.cachedInputTokens } }
      : {}),
  };
}

function usageResponses(usage: IRUsage) {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
    ...(usage.reasoningTokens !== undefined
      ? { output_tokens_details: { reasoning_tokens: usage.reasoningTokens } }
      : {}),
    ...(usage.cachedInputTokens !== undefined
      ? { input_tokens_details: { cached_tokens: usage.cachedInputTokens } }
      : {}),
  };
}

function toolState(map: Map<string, ToolCallState>, id: string, name = ""): ToolCallState {
  const existing = map.get(id);
  if (existing) {
    if (name) existing.name = name;
    return existing;
  }
  const created = { id, name, arguments: "" };
  map.set(id, created);
  return created;
}

async function collect(
  ctx: CallContext,
  request: IRRequest,
  signal: AbortSignal,
  requestPath: string,
): Promise<CollectedResponse> {
  const tools = new Map<string, ToolCallState>();
  const result: CollectedResponse = {
    text: "",
    reasoning: "",
    tools: [],
    finishReason: "stop",
    usage: {},
  };
  for await (const event of streamChat({
    ctx,
    request,
    cacheKey: ctx.apiKeyId ?? undefined,
    abortSignal: signal,
    userAgent: await getGatewayUA(),
    requestPath,
  })) {
    if (signal.aborted) break;
    switch (event.type) {
      case "text-delta": result.text += event.text; break;
      case "reasoning-delta": result.reasoning += event.text; break;
      case "tool-call-start": toolState(tools, event.toolCallId, event.toolName); break;
      case "tool-call-delta": toolState(tools, event.toolCallId).arguments += event.delta; break;
      case "tool-call": {
        const tool = toolState(tools, event.toolCallId, event.toolName);
        tool.arguments = JSON.stringify(event.args ?? {});
        break;
      }
      case "finish":
        if (!isSupportedFinishReason(event.finishReason)) {
          result.error = {
            code: ErrorCode.GATEWAY_GENERATION_FAILED,
            message: unknownFinishMessage(event.finishReason),
          };
          break;
        }
        result.finishReason = event.finishReason;
        result.usage = mergeUsage(result.usage, event.usage);
        break;
      case "usage":
        result.usage = mergeUsage(result.usage, event.usage);
        break;
      case "error":
        result.error = {
          code: normalizeErrorCode(event.code),
          message: event.error,
          details: event.details,
        };
        break;
      default:
        break;
    }
  }
  result.tools = [...tools.values()];
  return result;
}

function chatJson(id: string, model: string, created: number, result: CollectedResponse) {
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: result.text || null,
        ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
        ...(result.tools.length ? {
          tool_calls: result.tools.map((tool) => ({
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: tool.arguments },
          })),
        } : {}),
      },
      finish_reason: chatFinish(result.finishReason),
    }],
    usage: usageOpenAI(result.usage),
  };
}

function responsesJson(id: string, model: string, created: number, result: CollectedResponse) {
  const output: unknown[] = [];
  if (result.text || result.reasoning) {
    output.push({
      id: `msg_${id.slice(5)}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        ...(result.reasoning ? [{ type: "reasoning_text", text: result.reasoning }] : []),
        ...(result.text ? [{ type: "output_text", text: result.text, annotations: [] }] : []),
      ],
    });
  }
  output.push(...result.tools.map((tool) => ({
    id: `fc_${tool.id}`,
    type: "function_call",
    status: "completed",
    call_id: tool.id,
    name: tool.name,
    arguments: tool.arguments,
  })));
  return {
    id,
    object: "response",
    created_at: created,
    status: result.finishReason === "length" || result.finishReason === "content-filter" ? "incomplete" : "completed",
    ...(result.finishReason === "length"
      ? { incomplete_details: { reason: "max_output_tokens" } }
      : result.finishReason === "content-filter"
        ? { incomplete_details: { reason: "content_filter" } }
        : {}),
    model,
    output,
    output_text: result.text,
    usage: usageResponses(result.usage),
  };
}

function anthropicJson(id: string, model: string, result: CollectedResponse) {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content: [
      ...(result.reasoning ? [{ type: "thinking", thinking: result.reasoning, signature: "" }] : []),
      ...(result.text ? [{ type: "text", text: result.text }] : []),
      ...result.tools.map((tool) => ({ type: "tool_use", id: tool.id, name: tool.name, input: parseArguments(tool.arguments) })),
    ],
    stop_reason: anthropicFinish(result.finishReason),
    stop_sequence: null,
    usage: {
      input_tokens: result.usage.inputTokens ?? 0,
      output_tokens: result.usage.outputTokens ?? 0,
      ...(result.usage.cachedInputTokens !== undefined ? { cache_read_input_tokens: result.usage.cachedInputTokens } : {}),
    },
  };
}

function geminiJson(result: CollectedResponse) {
  return {
    candidates: [{
      content: {
        role: "model",
        parts: [
          ...(result.reasoning ? [{ text: result.reasoning, thought: true }] : []),
          ...(result.text ? [{ text: result.text }] : []),
          ...result.tools.map((tool) => ({ functionCall: { id: tool.id, name: tool.name, args: parseArguments(tool.arguments) } })),
        ],
      },
      finishReason: geminiFinish(result.finishReason),
      index: 0,
    }],
    usageMetadata: {
      promptTokenCount: result.usage.inputTokens ?? 0,
      candidatesTokenCount: result.usage.outputTokens ?? 0,
      totalTokenCount: result.usage.totalTokens ?? 0,
      ...(result.usage.cachedInputTokens !== undefined ? { cachedContentTokenCount: result.usage.cachedInputTokens } : {}),
      ...(result.usage.reasoningTokens !== undefined ? { thoughtsTokenCount: result.usage.reasoningTokens } : {}),
    },
  };
}

function parseArguments(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

function chatFinish(reason: string): string {
  return reason === "tool-calls" ? "tool_calls" : reason;
}

function anthropicFinish(reason: string): string {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

function geminiFinish(reason: string): string {
  if (reason === "length") return "MAX_TOKENS";
  if (reason === "content-filter") return "SAFETY";
  return "STOP";
}

/** 非流式协议响应，四种入口共用同一 collector。 */
export async function nonStreamProtocolResponse(
  protocol: GatewayProtocol,
  ctx: CallContext,
  request: IRRequest,
  signal: AbortSignal,
  requestPath: string,
): Promise<Response> {
  const result = await collect(ctx, request, signal, requestPath);
  if (result.error) {
    return protocolErrorResponse(protocol, result.error.code, result.error.message, result.error.details);
  }
  if (signal.aborted) return new Response(null, { status: 499 });
  if (protocol === "anthropic" && result.finishReason === "content-filter") {
    return protocolErrorResponse(
      protocol,
      ErrorCode.GATEWAY_GENERATION_FAILED,
      "Content filtered by upstream provider.",
    );
  }
  const created = Math.floor(Date.now() / 1000);
  switch (protocol) {
    case "openai-chat":
      return Response.json(chatJson(`chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`, request.model, created, result));
    case "openai-responses":
      return Response.json(responsesJson(`resp_${crypto.randomUUID().replaceAll("-", "")}`, request.model, created, result));
    case "anthropic":
      return Response.json(anthropicJson(`msg_${crypto.randomUUID().replaceAll("-", "")}`, request.model, result));
    case "gemini":
      return Response.json(geminiJson(result));
  }
}

interface StreamState {
  textStarted: boolean;
  reasoningStarted: boolean;
  text: string;
  reasoning: string;
  textIndex?: number;
  reasoningIndex?: number;
  nextIndex: number;
  tools: Map<string, ToolCallState>;
  toolIndexes: Map<string, number>;
  completedTools: Set<string>;
  closedBlocks: Set<number>;
  sequenceNumber: number;
  usage: IRUsage;
}

function sse(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, data: unknown, event?: string) {
  const prefix = event ? `event: ${event}\n` : "";
  controller.enqueue(encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`));
}

function responseSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  state: StreamState,
  data: Record<string, unknown>,
  event: string,
) {
  sse(controller, encoder, { ...data, sequence_number: state.sequenceNumber++ }, event);
}

/** 流式响应：一次消费 streamChat，只在边界改变 SSE 形状。 */
export function streamProtocolResponse(
  protocol: GatewayProtocol,
  ctx: CallContext,
  request: IRRequest,
  sourceSignal: AbortSignal,
  requestPath: string,
): Response {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const abort = () => abortController.abort(sourceSignal.reason);
  if (sourceSignal.aborted) abort();
  else sourceSignal.addEventListener("abort", abort, { once: true });
  const id = protocol === "openai-chat"
    ? `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`
    : protocol === "openai-responses"
      ? `resp_${crypto.randomUUID().replaceAll("-", "")}`
      : `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);
  const state: StreamState = {
    textStarted: false,
    reasoningStarted: false,
    text: "",
    reasoning: "",
    nextIndex: 0,
    tools: new Map(),
    toolIndexes: new Map(),
    completedTools: new Set(),
    closedBlocks: new Set(),
    sequenceNumber: 0,
    usage: {},
  };

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        emitStart(protocol, controller, encoder, id, request.model, created, state);
        const userAgent = await getGatewayUA();
        if (abortController.signal.aborted) return;
        for await (const event of streamChat({
          ctx,
          request,
          cacheKey: ctx.apiKeyId ?? undefined,
          abortSignal: abortController.signal,
          userAgent,
          requestPath,
        })) {
          if (abortController.signal.aborted) break;
          emitEvent(protocol, controller, encoder, id, request.model, created, event, state);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          emitStreamError(
            protocol,
            controller,
            encoder,
            id,
            redactErrorMessage(error, [], "Generation failed"),
            state,
          );
        }
      } finally {
        sourceSignal.removeEventListener("abort", abort);
        if (!abortController.signal.aborted) controller.close();
      }
    },
    cancel() {
      abortController.abort();
      sourceSignal.removeEventListener("abort", abort);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function emitStart(
  protocol: GatewayProtocol,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  id: string,
  model: string,
  created: number,
  state: StreamState,
) {
  if (protocol === "openai-responses") {
    const response = { id, object: "response", created_at: created, status: "in_progress", model, output: [] };
    responseSse(controller, encoder, state, { type: "response.created", response }, "response.created");
  } else if (protocol === "anthropic") {
    sse(controller, encoder, {
      type: "message_start",
      message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } },
    }, "message_start");
  }
}

function emitEvent(
  protocol: GatewayProtocol,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  id: string,
  model: string,
  created: number,
  event: StreamEvent,
  state: StreamState,
) {
  switch (event.type) {
    case "text-delta": emitText(protocol, controller, encoder, id, model, created, event.text, state); break;
    case "reasoning-delta": emitReasoning(protocol, controller, encoder, id, model, created, event.text, state); break;
    case "tool-call-start": emitToolStart(protocol, controller, encoder, id, model, created, event, state); break;
    case "tool-call-delta": emitToolDelta(protocol, controller, encoder, id, model, created, event, state); break;
    case "tool-call-end": emitToolEnd(protocol, controller, encoder, id, event.toolCallId, state); break;
    case "tool-call": {
      if (!state.tools.has(event.toolCallId)) {
        emitToolStart(protocol, controller, encoder, id, model, created, {
          type: "tool-call-start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        }, state);
      }
      const tool = toolState(state.tools, event.toolCallId, event.toolName);
      tool.arguments = JSON.stringify(event.args ?? {});
      if (protocol === "gemini") emitGeminiTool(controller, encoder, event.toolCallId, state);
      else emitToolEnd(protocol, controller, encoder, id, event.toolCallId, state);
      break;
    }
    case "usage": state.usage = mergeUsage(state.usage, event.usage); break;
    case "finish": emitFinish(protocol, controller, encoder, id, model, created, event, state); break;
    case "error": emitStreamError(protocol, controller, encoder, id, event.error, state, event.code, event.details); break;
    default: break;
  }
}

function emitText(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, model: string, created: number, text: string, state: StreamState) {
  state.text += text;
  if (protocol === "openai-chat") {
    sse(c, e, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  } else if (protocol === "openai-responses") {
    if (!state.textStarted) {
      state.textStarted = true;
      state.textIndex = state.nextIndex++;
      responseSse(c, e, state, { type: "response.output_item.added", output_index: state.textIndex, item: responseMessage(id, state, "in_progress") }, "response.output_item.added");
      responseSse(c, e, state, { type: "response.content_part.added", item_id: `msg_${id.slice(5)}`, output_index: state.textIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [], logprobs: [] } }, "response.content_part.added");
    }
    responseSse(c, e, state, { type: "response.output_text.delta", item_id: `msg_${id.slice(5)}`, output_index: state.textIndex!, content_index: 0, delta: text, logprobs: [] }, "response.output_text.delta");
  } else if (protocol === "anthropic") {
    if (!state.textStarted) {
      state.textStarted = true;
      state.textIndex = state.nextIndex++;
      sse(c, e, { type: "content_block_start", index: state.textIndex, content_block: { type: "text", text: "" } }, "content_block_start");
    }
    sse(c, e, { type: "content_block_delta", index: state.textIndex, delta: { type: "text_delta", text } }, "content_block_delta");
  } else {
    sse(c, e, { candidates: [{ content: { role: "model", parts: [{ text }] }, index: 0 }] });
  }
}

function emitReasoning(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, model: string, created: number, text: string, state: StreamState) {
  state.reasoning += text;
  if (protocol === "openai-chat") {
    sse(c, e, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }] });
  } else if (protocol === "openai-responses") {
    if (!state.reasoningStarted) {
      state.reasoningStarted = true;
      state.reasoningIndex = state.nextIndex++;
      responseSse(c, e, state, { type: "response.output_item.added", output_index: state.reasoningIndex, item: responseReasoning(id, state, "in_progress") }, "response.output_item.added");
      responseSse(c, e, state, { type: "response.reasoning_summary_part.added", item_id: `rs_${id.slice(5)}`, output_index: state.reasoningIndex, summary_index: 0, part: { type: "summary_text", text: "" } }, "response.reasoning_summary_part.added");
    }
    responseSse(c, e, state, { type: "response.reasoning_summary_text.delta", item_id: `rs_${id.slice(5)}`, output_index: state.reasoningIndex!, summary_index: 0, delta: text }, "response.reasoning_summary_text.delta");
  } else if (protocol === "anthropic") {
    if (!state.reasoningStarted) {
      state.reasoningStarted = true;
      state.reasoningIndex = state.nextIndex++;
      sse(c, e, { type: "content_block_start", index: state.reasoningIndex, content_block: { type: "thinking", thinking: "", signature: "" } }, "content_block_start");
    }
    sse(c, e, { type: "content_block_delta", index: state.reasoningIndex, delta: { type: "thinking_delta", thinking: text } }, "content_block_delta");
  } else {
    sse(c, e, { candidates: [{ content: { role: "model", parts: [{ text, thought: true }] }, index: 0 }] });
  }
}

function ensureToolIndex(state: StreamState, id: string, protocol: GatewayProtocol): number {
  const existing = state.toolIndexes.get(id);
  if (existing !== undefined) return existing;
  const index = protocol === "openai-chat" || protocol === "gemini"
    ? state.toolIndexes.size
    : state.nextIndex++;
  state.toolIndexes.set(id, index);
  return index;
}

function emitToolStart(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, model: string, created: number, event: Extract<StreamEvent, { type: "tool-call-start" }>, state: StreamState) {
  const index = ensureToolIndex(state, event.toolCallId, protocol);
  toolState(state.tools, event.toolCallId, event.toolName);
  if (protocol === "openai-chat") {
    sse(c, e, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index, id: event.toolCallId, type: "function", function: { name: event.toolName, arguments: "" } }] }, finish_reason: null }] });
  } else if (protocol === "openai-responses") {
    responseSse(c, e, state, { type: "response.output_item.added", output_index: index, item: responseTool(event.toolCallId, state, "in_progress") }, "response.output_item.added");
  } else if (protocol === "anthropic") {
    sse(c, e, { type: "content_block_start", index, content_block: { type: "tool_use", id: event.toolCallId, name: event.toolName, input: {} } }, "content_block_start");
  }
}

function emitToolDelta(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, model: string, created: number, event: Extract<StreamEvent, { type: "tool-call-delta" }>, state: StreamState) {
  const index = ensureToolIndex(state, event.toolCallId, protocol);
  toolState(state.tools, event.toolCallId).arguments += event.delta;
  if (protocol === "openai-chat") {
    sse(c, e, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: event.delta } }] }, finish_reason: null }] });
  } else if (protocol === "openai-responses") {
    responseSse(c, e, state, { type: "response.function_call_arguments.delta", item_id: `fc_${event.toolCallId}`, output_index: index, delta: event.delta }, "response.function_call_arguments.delta");
  } else if (protocol === "anthropic") {
    sse(c, e, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: event.delta } }, "content_block_delta");
  }
}

function emitToolEnd(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, toolCallId: string, state: StreamState) {
  if (state.completedTools.has(toolCallId)) return;
  const tool = state.tools.get(toolCallId);
  const index = state.toolIndexes.get(toolCallId);
  if (!tool || index === undefined || protocol === "gemini") return;
  if (protocol === "openai-responses") {
    responseSse(c, e, state, { type: "response.function_call_arguments.done", item_id: `fc_${toolCallId}`, output_index: index, name: tool.name, arguments: tool.arguments }, "response.function_call_arguments.done");
    responseSse(c, e, state, { type: "response.output_item.done", output_index: index, item: responseTool(toolCallId, state, "completed") }, "response.output_item.done");
  } else if (protocol === "anthropic") {
    closeAnthropicBlock(c, e, index, state);
  }
  state.completedTools.add(toolCallId);
}

function emitGeminiTool(c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, toolCallId: string, state: StreamState) {
  if (state.completedTools.has(toolCallId)) return;
  const tool = state.tools.get(toolCallId);
  if (!tool) return;
  sse(c, e, { candidates: [{ content: { role: "model", parts: [{ functionCall: { id: tool.id, name: tool.name, args: parseArguments(tool.arguments) } }] }, index: 0 }] });
  state.completedTools.add(toolCallId);
}

function emitFinish(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, model: string, created: number, event: Extract<StreamEvent, { type: "finish" }>, state: StreamState) {
  if (!isSupportedFinishReason(event.finishReason)) {
    emitStreamError(protocol, c, e, id, unknownFinishMessage(event.finishReason), state);
    return;
  }
  state.usage = mergeUsage(state.usage, event.usage);
  if (protocol === "openai-chat") {
    sse(c, e, { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: chatFinish(event.finishReason) }], usage: usageOpenAI(state.usage) });
    c.enqueue(e.encode("data: [DONE]\n\n"));
  } else if (protocol === "openai-responses") {
    closeResponsesReasoning(c, e, id, state);
    closeResponsesText(c, e, id, state);
    for (const toolId of state.tools.keys()) emitToolEnd(protocol, c, e, id, toolId, state);
    const incomplete = event.finishReason === "length" || event.finishReason === "content-filter";
    const eventType = incomplete ? "response.incomplete" : "response.completed";
    responseSse(c, e, state, {
      type: eventType,
      response: {
        id,
        object: "response",
        created_at: created,
        status: incomplete ? "incomplete" : "completed",
        model,
        output: responseOutputs(id, state),
        usage: usageResponses(state.usage),
        ...(event.finishReason === "length"
          ? { incomplete_details: { reason: "max_output_tokens" } }
          : event.finishReason === "content-filter"
            ? { incomplete_details: { reason: "content_filter" } }
            : {}),
      },
    }, eventType);
  } else if (protocol === "anthropic") {
    if (event.finishReason === "content-filter") {
      emitStreamError(protocol, c, e, id, "Content filtered by upstream provider.", state);
      return;
    }
    if (state.reasoningIndex !== undefined) closeAnthropicBlock(c, e, state.reasoningIndex, state);
    if (state.textIndex !== undefined) closeAnthropicBlock(c, e, state.textIndex, state);
    for (const toolId of state.tools.keys()) emitToolEnd(protocol, c, e, id, toolId, state);
    sse(c, e, { type: "message_delta", delta: { stop_reason: anthropicFinish(event.finishReason), stop_sequence: null }, usage: anthropicUsage(state.usage) }, "message_delta");
    sse(c, e, { type: "message_stop" }, "message_stop");
  } else {
    sse(c, e, { candidates: [{ content: { role: "model", parts: [] }, finishReason: geminiFinish(event.finishReason), index: 0 }], usageMetadata: { promptTokenCount: state.usage.inputTokens ?? 0, candidatesTokenCount: state.usage.outputTokens ?? 0, totalTokenCount: state.usage.totalTokens ?? 0, ...(state.usage.cachedInputTokens !== undefined ? { cachedContentTokenCount: state.usage.cachedInputTokens } : {}), ...(state.usage.reasoningTokens !== undefined ? { thoughtsTokenCount: state.usage.reasoningTokens } : {}) } });
  }
}

function emitStreamError(protocol: GatewayProtocol, c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, message: string, state: StreamState, code?: string, details?: Record<string, unknown>) {
  const normalized = normalizeErrorCode(code);
  const meta = ERROR_META[normalized];
  const parameter = typeof details?.parameter === "string" ? details.parameter : null;
  if (protocol === "openai-responses") {
    responseSse(c, e, state, { type: "error", code: normalized, message, param: parameter }, "error");
  } else if (protocol === "anthropic") {
    sse(c, e, { type: "error", error: { type: anthropicErrorType(meta.status), message } }, "error");
  } else if (protocol === "gemini") {
    sse(c, e, { error: { code: meta.status, message, status: geminiErrorStatus(meta.status) } });
  } else {
    sse(c, e, { error: { message, type: meta.type, param: parameter, code: normalized } });
  }
}

function closeAnthropicBlock(c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, index: number, state: StreamState) {
  if (state.closedBlocks.has(index)) return;
  sse(c, e, { type: "content_block_stop", index }, "content_block_stop");
  state.closedBlocks.add(index);
}

function closeResponsesText(c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, state: StreamState) {
  if (state.textIndex === undefined || state.closedBlocks.has(state.textIndex)) return;
  const itemId = `msg_${id.slice(5)}`;
  responseSse(c, e, state, { type: "response.output_text.done", item_id: itemId, output_index: state.textIndex, content_index: 0, text: state.text, logprobs: [] }, "response.output_text.done");
  responseSse(c, e, state, { type: "response.content_part.done", item_id: itemId, output_index: state.textIndex, content_index: 0, part: { type: "output_text", text: state.text, annotations: [], logprobs: [] } }, "response.content_part.done");
  responseSse(c, e, state, { type: "response.output_item.done", output_index: state.textIndex, item: responseMessage(id, state, "completed") }, "response.output_item.done");
  state.closedBlocks.add(state.textIndex);
}

function closeResponsesReasoning(c: ReadableStreamDefaultController<Uint8Array>, e: TextEncoder, id: string, state: StreamState) {
  if (state.reasoningIndex === undefined || state.closedBlocks.has(state.reasoningIndex)) return;
  const itemId = `rs_${id.slice(5)}`;
  responseSse(c, e, state, { type: "response.reasoning_summary_text.done", item_id: itemId, output_index: state.reasoningIndex, summary_index: 0, text: state.reasoning }, "response.reasoning_summary_text.done");
  responseSse(c, e, state, { type: "response.reasoning_summary_part.done", item_id: itemId, output_index: state.reasoningIndex, summary_index: 0, part: { type: "summary_text", text: state.reasoning } }, "response.reasoning_summary_part.done");
  responseSse(c, e, state, { type: "response.output_item.done", output_index: state.reasoningIndex, item: responseReasoning(id, state, "completed") }, "response.output_item.done");
  state.closedBlocks.add(state.reasoningIndex);
}

function responseMessage(id: string, state: StreamState, status: "in_progress" | "completed") {
  return { id: `msg_${id.slice(5)}`, type: "message", status, role: "assistant", content: status === "completed" ? [{ type: "output_text", text: state.text, annotations: [], logprobs: [] }] : [] };
}

function responseReasoning(id: string, state: StreamState, status: "in_progress" | "completed") {
  return { id: `rs_${id.slice(5)}`, type: "reasoning", status, summary: status === "completed" ? [{ type: "summary_text", text: state.reasoning }] : [] };
}

function responseTool(toolCallId: string, state: StreamState, status: "in_progress" | "completed") {
  const tool = state.tools.get(toolCallId)!;
  return { id: `fc_${toolCallId}`, type: "function_call", status, call_id: toolCallId, name: tool.name, arguments: tool.arguments };
}

function responseOutputs(id: string, state: StreamState): unknown[] {
  const indexed: Array<[number, unknown]> = [];
  if (state.reasoningIndex !== undefined) indexed.push([state.reasoningIndex, responseReasoning(id, state, "completed")]);
  if (state.textIndex !== undefined) indexed.push([state.textIndex, responseMessage(id, state, "completed")]);
  for (const [toolId, index] of state.toolIndexes) indexed.push([index, responseTool(toolId, state, "completed")]);
  return indexed.sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

function anthropicUsage(usage: IRUsage) {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    ...(usage.cachedInputTokens !== undefined ? { cache_read_input_tokens: usage.cachedInputTokens } : {}),
  };
}

function anthropicErrorType(status: number): string {
  if (status === 400) return "invalid_request_error";
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limit_error";
  return "api_error";
}

function geminiErrorStatus(status: number): string {
  if (status === 400) return "INVALID_ARGUMENT";
  if (status === 401 || status === 403) return "UNAUTHENTICATED";
  if (status === 429) return "RESOURCE_EXHAUSTED";
  return "INTERNAL";
}
