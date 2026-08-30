/**
 * 流式核心 —— WebChat 和对外网关共用的唯一流式入口。
 *
 * 职责:
 *   1. resolveRoutes(ctx, model) → 有序路由链(负载均衡已加权打乱)
 *   2. 逐条路由尝试:buildLanguageModel → streamText
 *      首条失败(连接/认证类)→ 故障转移到下一条
 *   3. 流式产出统一 StreamEvent(text-delta / tool-call / usage / finish / error)
 *   4. try/finally 兜底:即使中断也记录用量(status=interrupted/failed)
 *
 * 用量记录在 streamChat 层(持有 ctx),不塞进 streamText 的 onFinish 闭包。
 * 借鉴 DEEIX:run_id 标识一次生成;用量含 cache 拆分。
 */
import { streamText, generateText, jsonSchema, Output, type ModelMessage, type ToolSet } from "ai";
import { resolveRoutes, resolveRoutesById } from "@/lib/routing";
import {
  markProviderStreamUsageUnsupported,
  markRouteToolsUnsupported,
} from "@/lib/repositories/route-repository";
import { buildLanguageModelWithKey, resolveRouteApiFormat } from "@/lib/providers/registry";
import { resolveProviderTimeouts } from "@/lib/providers/timeouts";
import { getChatUA } from "@/lib/system-settings/ua";
import { gatewayBreaker } from "@/lib/circuit-breaker";
import type { LogUsageParams } from "@/lib/usage";
import { classifyError } from "@/lib/error-classify";
import { redactErrorMessage } from "@/lib/redaction";
import {
  buildReasoningProviderOptions,
  clampReasoningLevel,
  getDefaultReasoningLevel,
} from "@/lib/reasoning";
import type {
  CallContext,
  IRRequest,
  IRMessage,
  IRToolDef,
  StreamEvent,
  IRUsage,
  ResolvedRoute,
} from "@/lib/providers/types";
import type { ProviderProtocol, ReasoningLevel } from "@/db/types";
import {
  executeAtomicGateway,
  executeGateway,
  gatewayTelemetry,
  isStreamOptionsUnsupportedError,
  isToolUnsupportedError,
  type GatewayAdapterSelection,
  type GatewayAttemptAdapter,
  type GatewayExecutionOutcome,
  type GatewayTelemetryPort,
  type StartExecutionTelemetry,
} from "@/lib/gateway-execution";

export {
  classifyStreamError,
  isAbortError,
  isFailoverableError,
  isKeyAuthError,
  isStreamOptionsUnsupportedError,
  isToolUnsupportedError,
  isRetryableForKey,
} from "@/lib/gateway-execution";

export interface StreamChatOptions {
  ctx: CallContext;
  request: IRRequest;
  /** 标识一次生成(WebChat 传入 message 的 run_id;网关自动生成)。 */
  runId?: string;
  /** 副任务类型(title/memory/compact/web_search);主回复 / 网关请求不传 → null。 */
  taskKind?: string;
  /** 会话级 cache key(chat=conversationId / 网关=apiKeyId);用于注入 prompt 缓存控制,缺省不注入。 */
  cacheKey?: string;
  /**
   * 模型 id(WebChat byId 路由解析)。提供时走 resolveRoutesById(public ∪ owner 可见),
   * 避免 public/private 同名歧义;缺省回退 resolveRoutes(by name,网关/副任务沿用)。
   */
  modelId?: string;
  /**
   * 中止信号(WebChat 透传客户端断开)。abort 时透传给 streamText,中止上游 fetch,
   * 避免继续写已关闭 socket 触发 Socket closed unexpectedly → uncaughtException。
   * 网关 / 副任务不传,行为不变。
   */
  abortSignal?: AbortSignal;
  /**
   * 上游请求 User-Agent(chat 工作台 / 网关各传不同 UA;副任务 generateChat 缺省读 getChatUA)。
   * 注入到 registry 的 customFetch,覆盖 AI SDK 默认 UA。
   */
  userAgent?: string;
  /** Agent loop 内部步骤收集终态用量,由外层统一记录。 */
  suppressFinalUsageLog?: boolean;
  /** 仅与 suppressFinalUsageLog 配合使用,接收步骤终态信息。 */
  onFinalUsage?: (result: StreamChatFinalUsage) => void;
  /** Agent loop 内部注入共享 execution session；普通调用不传。 */
  telemetry?: GatewayTelemetryPort;
  /** 对外网关实际入口路径；用于统一 execution telemetry。 */
  requestPath?: string;
  /** 首个真实 Provider attempt 前执行的严格门禁。 */
  onProviderStart?: () => Promise<void>;
}

interface StreamChatFinalUsage {
  params: LogUsageParams;
  firstTokenAt?: number;
}

/** 统一 execution engine 驱动的 Chat 流式入口。 */
export async function* streamChat(
  opts: StreamChatOptions,
): AsyncGenerator<StreamEvent, void, unknown> {
  const { ctx, request, runId = `run_${crypto.randomUUID()}` } = opts;
  let releaseStream: () => void = () => {};
  try {
    const metrics = await import("@/lib/infra/metrics");
    metrics.acquireStream();
    releaseStream = metrics.releaseStream;
  } catch {
    /* metrics 不可用时降级为 no-op */
  }

  let execution: AsyncIterator<StreamEvent, GatewayExecutionOutcome<void>, void> | undefined;
  let outcome: GatewayExecutionOutcome<void> | undefined;
  let executionRequest = request;
  let toolsFallbackAttempted = false;
  const debugEventCounts: Partial<Record<StreamEvent["type"], number>> = {};

  const createExecution = (currentRequest: IRRequest) => {
    const adapter: GatewayAttemptAdapter<StreamEvent, void> = async function* ({
      route,
      apiKey,
      abortSignal,
    }) {
      const reasoningLevel = clampReasoningLevel(
        route.capabilities,
        currentRequest.reasoning ?? getDefaultReasoningLevel(route.capabilities),
      );
      const timing: { firstTokenAt?: number } = {};
      let firstTokenReported = false;
      let usage: IRUsage = {};
      for await (const event of streamWithRoute(
        route,
        currentRequest,
        apiKey,
        reasoningLevel,
        timing,
        opts.cacheKey,
        abortSignal,
        opts.userAgent,
      )) {
        if (event.type === "finish") usage = event.usage;
        const eventFirstTokenAt = !firstTokenReported
          && event.type === "text-delta"
          && event.text.length > 0
          ? timing.firstTokenAt
          : undefined;
        if (eventFirstTokenAt !== undefined) firstTokenReported = true;
        yield {
          value: event,
          commitsResponse:
            event.type === "text-delta"
            || event.type === "reasoning-delta"
            || event.type === "tool-call-start"
            || event.type === "tool-call-delta"
            || event.type === "tool-call-end"
            || event.type === "tool-call",
          firstTokenAt: eventFirstTokenAt,
        };
      }
      return { value: undefined, usage, firstTokenAt: timing.firstTokenAt, reasoningLevel };
    };

    return executeGateway({
      ctx,
      requestId: runId,
      operation: "chat.stream",
      model: currentRequest.model,
      modelId: opts.modelId,
      requestPath: ctx.source === "gateway" ? (opts.requestPath ?? "/v1/chat/completions") : undefined,
      taskKind: opts.taskKind,
      abortSignal: opts.abortSignal,
      onProviderStart: opts.onProviderStart,
      resolveRoutes: () => opts.modelId
        ? resolveRoutesById(ctx, opts.modelId)
        : resolveRoutes(ctx, currentRequest.model),
      selectAdapter: (route) => currentRequest.tools?.length
        && (!route.supportsTools || route.capabilities?.tools !== true)
        ? null
        : selectChatAdapter(route, currentRequest, adapter),
      isToolUnsupported: currentRequest.tools?.length ? isToolUnsupportedError : undefined,
      onToolUnsupported: currentRequest.tools?.length
        ? (route) => markRouteToolsUnsupported(route.routeId)
        : undefined,
      isStreamOptionsUnsupported: (route, error) =>
        route.protocol === "openai-compatible"
        && resolveRouteApiFormat(route) === "openai-chat"
        && route.provider.supportsStreamUsage !== false
        && isStreamOptionsUnsupportedError(error),
      onStreamOptionsUnsupported: async (route) => {
        const { id, baseUrl } = route.provider;
        route.provider.supportsStreamUsage = false;
        await markProviderStreamUsageUnsupported(id, baseUrl);
      },
      telemetry: opts.telemetry ?? gatewayTelemetry,
      breaker: gatewayBreaker,
    });
  };

  try {
    while (true) {
      const currentRequest = executionRequest;
      execution = createExecution(currentRequest);
      while (true) {
        const next = await execution.next();
        if (next.done) {
          const currentOutcome = next.value;
          const shouldFallbackWithoutTools = !toolsFallbackAttempted
            && currentRequest.tools?.length
            && currentOutcome.status === "failed"
            && !currentOutcome.committed
            && (currentOutcome.error?.code === "tools_not_supported"
              || currentOutcome.error?.code === "protocol_not_supported");
          if (shouldFallbackWithoutTools) {
            toolsFallbackAttempted = true;
            executionRequest = { ...currentRequest, tools: undefined };
            break;
          }
          outcome = currentOutcome;
          break;
        }
        debugEventCounts[next.value.type] = (debugEventCounts[next.value.type] ?? 0) + 1;
        yield next.value;
      }
      if (outcome) break;
    }

    if (outcome.status === "failed") {
      yield {
        type: "error",
        error: outcome.error?.message ?? "生成失败",
        code: ctx.source === "gateway"
          ? outcome.error?.code ?? "generation_failed"
          : "generation_failed",
        details: ctx.source === "gateway" ? outcome.error?.details : undefined,
      };
    }
  } finally {
    // 外层消费者可能在某个事件后直接 return;确保内部 engine 也进入 finally。
    if (!outcome && execution) {
      try {
        const closing = execution.return ? execution.return() : undefined;
        void closing?.catch(() => undefined);
      } catch {
        /* 内部关闭失败不应覆盖已产生的流结果。 */
      }
    }
    releaseStream();
    if (ctx.source === "gateway" && process.env.GATEWAY_DEBUG_REQUESTS === "true") {
      console.info("[gateway:debug] response", JSON.stringify({
        model: request.model,
        status: outcome?.status ?? (opts.abortSignal?.aborted ? "interrupted" : "failed"),
        committed: outcome?.committed ?? false,
        hasVisibleText: outcome?.firstTokenAt !== undefined,
        eventCounts: debugEventCounts,
        usage: outcome?.usage ?? {},
        provider: outcome?.route?.provider.name,
        protocol: outcome?.route?.protocol,
        apiFormat: outcome?.route?.apiFormat,
        upstreamModel: outcome?.route?.upstreamModelName,
      }));
    }
    if (opts.suppressFinalUsageLog) {
      const finalStatus = outcome?.status ?? (opts.abortSignal?.aborted ? "interrupted" : "failed");
      try {
        opts.onFinalUsage?.({
          params: {
            ctx,
            runId,
            model: request.model,
            providerRef: outcome?.route
              ? `${outcome.route.source}:${outcome.route.provider.id}`
              : undefined,
            usage: outcome?.usage ?? {},
            status: finalStatus,
            errorCode: outcome?.error?.code ?? (outcome ? undefined : finalStatus),
            errorMessage: outcome?.error?.message,
            errorPhase: outcome?.error?.phase,
            errorType: outcome?.error?.code ?? (outcome ? undefined : finalStatus),
            httpStatus: outcome?.error?.httpStatus,
            providerName: outcome?.route?.provider.name,
            routeId: outcome?.route?.routeId,
            routeName: outcome?.route
              ? `${outcome.route.provider.name} · ${outcome.route.upstreamModelName}`
              : undefined,
            upstreamModel: outcome?.route?.upstreamModelName,
            stream: true,
            taskKind: opts.taskKind,
            upstreamKeyMasked: outcome?.upstreamKeyMasked,
          },
          firstTokenAt: outcome?.firstTokenAt,
        });
      } catch {
        /* Agent telemetry 回调失败不应改写流终态。 */
      }
    }
  }
}

function selectChatAdapter(
  route: ResolvedRoute,
  request: IRRequest,
  adapter: GatewayAttemptAdapter<StreamEvent, void>,
): GatewayAdapterSelection<StreamEvent, void> {
  const developerIndex = request.messages.findIndex((message) => message.role === "developer");
  if (developerIndex >= 0) {
    const format = resolveRouteApiFormat(route);
    const supportsDeveloper = format === "openai-responses"
      || (format === "openai-chat" && route.protocol === "openai");
    if (!supportsDeveloper) {
      const parameter = `messages[${developerIndex}].role`;
      return {
        kind: "rejected",
        error: {
          code: "request.unsupported_parameter",
          message: `Unsupported parameter: '${parameter}'.`,
          phase: "request",
          httpStatus: 400,
          details: { parameter },
        },
      };
    }
  }
  return { kind: "selected", adapter };
}

/** 在 AI SDK 边界把 OpenAI 图片与工具消息 IR 转为 ModelMessage。 */
export function toModelMessages(messages: IRMessage[]): ModelMessage[] {
  const toolNamesByCallId = new Map<string, string>();
  for (const message of messages) {
    for (const toolCall of message.tool_calls ?? []) {
      toolNamesByCallId.set(toolCall.id, toolCall.function.name);
    }
  }

  return messages.map((message): ModelMessage => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      if (typeof message.content !== "string") {
        throw new Error("消息无效:助手工具调用内容必须是文本");
      }
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.tool_calls.map((toolCall) => ({
            type: "tool-call" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          })),
        ],
      };
    }

    if (message.role === "tool") {
      const toolCallId = message.tool_call_id;
      if (!toolCallId) throw new Error("消息无效:工具结果缺少调用 ID");
      const toolName = message.name ?? toolNamesByCallId.get(toolCallId);
      if (!toolName) throw new Error("消息无效:工具结果缺少工具名称");
      if (typeof message.content !== "string") {
        throw new Error("消息无效:工具结果必须是文本");
      }
      return {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId,
          toolName,
          output: { type: "text", value: message.content },
        }],
      };
    }

    if (message.role !== "user" || typeof message.content === "string") {
      return message as ModelMessage;
    }

    return {
      ...message,
      role: "user" as const,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return { type: "text" as const, text: part.text ?? "" };
        }
        if (!part.image_url?.url) {
          throw new Error("消息无效:图片缺少 URL");
        }
        return {
          type: "file" as const,
          data: new URL(part.image_url.url),
          mediaType: "image",
        };
      }),
    };
  });
}

/** 在 AI SDK 边界把 OpenAI function tools 数组转换为按名称索引的 ToolSet。 */
function toModelTools(tools?: IRToolDef[]): ToolSet | undefined {
  if (!tools?.length) return undefined;

  return Object.fromEntries(
    tools.map(({ function: definition }) => [
      definition.name,
      {
        type: "function" as const,
        description: definition.description,
        inputSchema: jsonSchema(
          (definition.parameters ?? {
            type: "object",
            properties: {},
            additionalProperties: false,
          }) as Parameters<typeof jsonSchema>[0],
        ),
        outputSchema: jsonSchema({}),
      },
    ]),
  );
}

function toModelToolChoice(choice: IRRequest["tool_choice"]): unknown {
  if (!choice || typeof choice === "string") return choice;
  return { type: "tool", toolName: choice.function.name };
}

function mergeProviderOptions(
  ...options: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const option of options) {
    for (const [provider, value] of Object.entries(option ?? {})) {
      const previous = result[provider];
      result[provider] = previous && value && typeof previous === "object" && typeof value === "object"
        ? { ...previous as Record<string, unknown>, ...value as Record<string, unknown> }
        : value;
    }
  }
  return result;
}

/**
 * 把 messages 里的 system 消息抽到顶层 system 参数。
 * 符合 AI SDK v5 推荐用法:system 不应混入 messages(会触发安全告警),
 * 且抽走后若对话消息为空会违反「至少一条 user/assistant」的对话 API 契约。
 *
 * 多条 system 按出现顺序拼接;对话消息为空时抛错,从源头杜绝上游 400。
 */
export function separateSystem(request: IRRequest): {
  system: string | undefined;
  messages: ModelMessage[];
} {
  const systemMessages = request.messages.filter((m) => m.role === "system" || m.role === "developer");
  const dialogueMessages = request.messages.filter((m) => m.role !== "system" && m.role !== "developer");
  if (dialogueMessages.length === 0) {
    throw new Error("消息无效:缺少用户消息,无法生成回复");
  }
  const system =
    systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n\n") || undefined;
  return { system, messages: toModelMessages(dialogueMessages) };
}

/** 用单条路由 + 指定 key 执行 streamText,产出统一事件。用量由调用方在 finish 事件后记录。 */
async function* streamWithRoute(
  route: ResolvedRoute,
  request: IRRequest,
  apiKey: string,
  reasoning: ReasoningLevel,
  /** 首 token 计时载体(mutable,由调用方持有;首个非空可见正文时回写 firstTokenAt)。 */
  timing: { firstTokenAt?: number },
  /** 会话级 cache key(chat=conversationId / 网关=apiKeyId);缺省不注入缓存控制。 */
  cacheKey?: string,
  /** 中止信号:透传给 streamText,客户端断开时中止上游 fetch,避免写已关闭 socket。 */
  abortSignal?: AbortSignal,
  /** 上游请求 User-Agent(覆盖 AI SDK 默认 UA)。 */
  userAgent?: string,
): AsyncGenerator<StreamEvent, void, unknown> {
  const model = buildLanguageModelWithKey(route, apiKey, cacheKey, reasoning, userAgent); // 失败则抛出,交由上层故障转移
  const { system, messages } = separateSystem(request);
  const requestProtocol = requestProtocolForRoute(route);

  // 按 protocol 注入 prompt 缓存控制(复刻 pi 兜底策略):
  //  - anthropic:system + 末条消息打 cache_control 断点(上游靠显式断点缓存)
  //  - openai:promptCacheKey(prompt_cache_key)辅助路由命中
  //  - openai-compatible:session affinity header 在 registry 注入,此处不处理
  const wantsCache = !!cacheKey;
  const isAnthropic = requestProtocol === "anthropic";
  const breakpoint = { type: "ephemeral" as const };
  const instructionsParam =
    isAnthropic && system && wantsCache
      ? { role: "system" as const, content: system, providerOptions: { anthropic: { cacheControl: breakpoint } } }
      : system;
  const messagesParam =
    isAnthropic && wantsCache && messages.length > 0
      ? messages.map((m, i) =>
          i === messages.length - 1 ? { ...m, providerOptions: { anthropic: { cacheControl: breakpoint } } } : m,
        )
      : messages;
  const cacheProviderOptions = requestProtocol === "openai" && cacheKey ? { openai: { promptCacheKey: cacheKey } } : {};
  const reasoningProviderOptions = requestProtocol === "openai-compatible"
    ? undefined
    : buildReasoningProviderOptions(requestProtocol, route.capabilities, reasoning);
  const structuredProviderOptions = request.response_format && requestProtocol === "anthropic"
    ? { anthropic: { structuredOutputMode: "outputFormat" } }
    : undefined;
  const responsesProviderOptions = resolveRouteApiFormat(route) === "openai-responses"
    ? {
        openai: {
          store: false,
          reasoningSummary: request.reasoning_summary ?? null,
          ...(request.reasoning_summary && route.capabilities?.reasoning
            ? { forceReasoning: true }
            : {}),
        },
      }
    : undefined;

  const generationOptions = {
    model,
    // 禁用 AI SDK 自动重试(默认 2 次):429/quota 不被重试放大 TPM,5xx 不加重上游压力;
    // 故障转移由上层 streamChat 的多 key + 多路由 + 熔断接管。
    maxRetries: 0,
    instructions: instructionsParam as never,
    messages: messagesParam,
    temperature: request.temperature,
    maxOutputTokens: request.max_tokens,
    topP: request.top_p,
    // 推理级别 + 缓存控制合并到 providerOptions(off/不支持则不传,等价普通对话)。
    // AI SDK SharedV4ProviderOptions 类型摩擦,此处沿用 providerOptions 的 as never 处理。
    providerOptions: mergeProviderOptions(
      reasoningProviderOptions,
      cacheProviderOptions,
      structuredProviderOptions,
      responsesProviderOptions,
    ) as never,
    // IR 使用 OpenAI function tools 数组；AI SDK 7 要求按工具名索引的 ToolSet。
    tools: toModelTools(request.tools),
    toolChoice: toModelToolChoice(request.tool_choice) as never,
    output: request.response_format
      ? Output.object({
          name: request.response_format.json_schema.name,
          description: request.response_format.json_schema.description,
          schema: jsonSchema(request.response_format.json_schema.schema as Parameters<typeof jsonSchema>[0]),
        }) as never
      : undefined,
    // 客户端断开时中止上游 fetch,避免继续写已关闭 socket → uncaughtException。
    abortSignal,
  };
  const result = streamText({
    ...generationOptions,
    timeout: {
      chunkMs: resolveProviderTimeouts(route.provider).streamIdleTimeoutMs,
    },
  });

  // 优先用 fullStream 捕获 tool-call 增量；stream fallback 兼容旧 adapter/test double。
  const eventStream = (result as typeof result & { stream?: typeof result.fullStream }).fullStream
    ?? (result as typeof result & { stream?: typeof result.fullStream }).stream;
  let hadOutput = false;
  for await (const part of eventStream) {
    switch (part.type) {
      case "text-delta":
        if (part.text.length > 0) hadOutput = true;
        // 首 token 采样:仅首个非空可见正文记录,reasoning/空 delta 不计入。
        if (part.text.length > 0 && timing.firstTokenAt === undefined) timing.firstTokenAt = Date.now();
        yield { type: "text-delta", text: part.text };
        break;
      case "reasoning-delta":
        if (part.text.length > 0) hadOutput = true;
        // 推理增量(如 deepseek-r1/Claude thinking)透传给 UI。
        yield { type: "reasoning-delta", text: part.text };
        break;
      case "tool-input-start":
        hadOutput = true;
        yield { type: "tool-call-start", toolCallId: part.id, toolName: part.toolName };
        break;
      case "tool-input-delta":
        hadOutput = true;
        yield { type: "tool-call-delta", toolCallId: part.id, delta: part.delta };
        break;
      case "tool-input-end":
        hadOutput = true;
        yield { type: "tool-call-end", toolCallId: part.id };
        break;
      case "tool-call":
        hadOutput = true;
        yield {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.input,
        };
        break;
      case "error":
        // 上游流式错误必须抛出,交由故障转移逻辑处理;
        // 否则 step 记录为空,await result.totalUsage 会被 SDK 二次包装成
        // "No output generated",真实错误(key/模型/额度等)会被吞掉。
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      default:
        break; // 其他 part 类型(step-start/tool-call-streaming 等)暂不转发。
    }
  }

  const finalUsage = await result.usage;
  const finishReason = await result.finishReason;
  if (!hadOutput && (finishReason === "stop" || finishReason === "other")) {
    const fallback = await generateText(generationOptions);
    if (fallback.reasoningText) {
      yield { type: "reasoning-delta", text: fallback.reasoningText };
    }
    if (fallback.text) {
      if (timing.firstTokenAt === undefined) timing.firstTokenAt = Date.now();
      yield { type: "text-delta", text: fallback.text };
    }
    for (const toolCall of fallback.toolCalls) {
      yield {
        type: "tool-call",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.input,
      };
    }
    yield {
      type: "finish",
      finishReason: fallback.finishReason,
      usage: {
        inputTokens: fallback.usage.inputTokens,
        outputTokens: fallback.usage.outputTokens,
        totalTokens: fallback.usage.totalTokens,
        reasoningTokens: fallback.usage.outputTokenDetails?.reasoningTokens,
        cachedInputTokens: fallback.usage.inputTokenDetails?.cacheReadTokens,
      },
    };
    return;
  }
  const irUsage: IRUsage = {
    inputTokens: finalUsage.inputTokens,
    outputTokens: finalUsage.outputTokens,
    totalTokens: finalUsage.totalTokens,
    reasoningTokens: finalUsage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: finalUsage.inputTokenDetails?.cacheReadTokens,
  };
  yield { type: "finish", finishReason, usage: irUsage };
}

/** 推理与缓存选项跟随 route wire format，不再跟随 Provider 默认连接类型。 */
function requestProtocolForRoute(route: ResolvedRoute): ProviderProtocol {
  switch (resolveRouteApiFormat(route)) {
    case "openai-chat":
      return route.protocol === "openai-compatible" ? "openai-compatible" : "openai";
    case "openai-responses":
      return "openai";
    case "anthropic-messages":
      return "anthropic";
    case "gemini-generate-content":
      return "gemini";
    default:
      return route.protocol;
  }
}

// ===========================================================================
// 非流式生成 —— 副任务专用(标题生成 / 记忆抽取等)
// ===========================================================================

export interface GenerateChatResult {
  text: string;
  usage?: IRUsage;
  /** 失败时为错误信息(生成失败时 text 为空)。 */
  error?: string;
}

export interface GenerateChatOptions extends StreamChatOptions {
  /** 副任务需要结构化 JSON 时启用;缺省保持普通文本。 */
  output?: "text" | "json";
}

/** 统一 execution engine 驱动的非流式 Chat 入口。 */
export async function generateChat(opts: GenerateChatOptions): Promise<GenerateChatResult> {
  const { ctx, request, runId = `run_${crypto.randomUUID()}` } = opts;
  const userAgent = opts.userAgent ?? await getChatUA();
  const adapter: GatewayAttemptAdapter<never, string> = async function* ({ route, apiKey, abortSignal }) {
    const model = buildLanguageModelWithKey(route, apiKey, undefined, undefined, userAgent);
    const { system, messages } = separateSystem(request);
    const result = await generateText({
      model,
      maxRetries: 0,
      instructions: system,
      messages,
      temperature: request.temperature,
      maxOutputTokens: request.max_tokens,
      topP: request.top_p,
      output: opts.output === "json" ? Output.json() : undefined,
      abortSignal,
    });
    return {
      value: result.text,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens,
        cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens,
      },
    };
  };
  const outcome = await executeAtomicGateway({
    ctx,
    requestId: runId,
    operation: "chat.generate",
    model: request.model,
    modelId: opts.modelId,
    taskKind: opts.taskKind,
    abortSignal: opts.abortSignal,
    onProviderStart: opts.onProviderStart,
    resolveRoutes: () => opts.modelId
      ? resolveRoutesById(ctx, opts.modelId)
      : resolveRoutes(ctx, request.model),
    selectAdapter: () => adapter,
    telemetry: gatewayTelemetry,
    breaker: gatewayBreaker,
  });
  if (outcome.status === "success") {
    return { text: outcome.result ?? "", usage: outcome.usage };
  }
  return { text: "", usage: outcome.usage, error: outcome.error?.message ?? "生成失败" };
}

export interface StreamChatWithToolsOptions extends StreamChatOptions {
  /** 允许的最大工具调用轮数(默认 5)。 */
  maxSteps?: number;
  /** 已解析的 MCP server(含工具清单 + 连接)。 */
  mcpServers?: import("@/lib/mcp/registry").ResolvedMcpServer[];
  /** WebChat 内置的唯一逻辑搜索工具；网关请求不传。 */
  webSearchTool?: {
    definition: IRToolDef;
    execute(toolCallId: string, args: unknown): Promise<{ result: unknown; isError: boolean }>;
  };
}

/**
 * 带 agent loop 的流式生成:模型调工具 → 执行 → 回填 → 继续,直到模型不再调工具。
 * 复用 streamChat 做单步生成,callMcpTool 执行工具。
 *
 * 事件契约:
 *   - text-delta / reasoning-delta / usage / tool-call / tool-result 按发生顺序透传
 *   - 中间轮 streamChat 的 finish 仅用于循环控制,不向外层 yield
 *   - 整个 agent loop 最多向外层发一次最终 finish(finishReason 取最终一轮,usage 跨轮聚合)
 *   - error 原样透传并立即终止 loop(不伪造 success finish)
 *
 * 用量日志契约:每个 Agent run 只由外层写一条聚合终态日志;
 * 步骤内的 key/路由尝试失败日志仍独立保留。
 */
export async function* streamChatWithTools(
  opts: StreamChatWithToolsOptions,
): AsyncGenerator<import("@/lib/providers/types").StreamEvent, void, unknown> {
  const { maxSteps = 5, mcpServers = [] } = opts;
  const agentRunId = opts.runId ?? `run_${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const telemetrySession = createAgentTelemetrySession(opts, agentRunId, startedAt);
  let aggregateUsage: IRUsage = {};
  const finalUsages: StreamChatFinalUsage[] = [];
  let firstTokenAt: number | undefined;
  let terminalStatus: LogUsageParams["status"] = "interrupted";
  let terminalError: unknown;
  let delegatedToPlainStream = false;
  let shouldLogAgentUsage = false;
  let hasExecutedTools = false;
  let summaryAttemptStart = 0;
  const collectFinalUsage = (result: StreamChatFinalUsage) => {
    aggregateUsage = addUsage(aggregateUsage, result.params.usage);
    finalUsages.push(result);
    if (firstTokenAt === undefined) firstTokenAt = result.firstTokenAt;
  };
  // working messages:每轮追加 tool 结果,进入下一轮。
  let messages: IRMessage[] = [];

  try {
    // 工具转换/registry 初始化也属于 Agent run；失败必须由 finally 写唯一终态。
    let tools = opts.request.tools;
    if (opts.webSearchTool) {
      const name = opts.webSearchTool.definition.function.name;
      if (tools?.some((tool) => tool.function.name === name)) {
        throw new Error(`内置工具名称冲突:${name}`);
      }
      tools = [...(tools ?? []), opts.webSearchTool.definition];
    }
    if (mcpServers.length > 0) {
      const { toIRTools } = await import("@/lib/mcp/registry");
      tools = [...(tools ?? []), ...toIRTools(mcpServers)];
    }
    if (!tools || tools.length === 0) {
      delegatedToPlainStream = true;
      yield* streamChat(opts);
      return;
    }

    shouldLogAgentUsage = true;
    const { callMcpTool } = await import("@/lib/mcp/registry");
    messages = [...opts.request.messages];
    for (let step = 0; step < maxSteps; step++) {
    const pendingToolCalls: {
      toolCallId: string;
      toolName: string;
      args: unknown;
    }[] = [];
    // 仅缓存本轮 finish;是否向外 yield 取决于是否已到 agent loop 终点。
    let stepFinish: Extract<StreamEvent, { type: "finish" }> | null = null;
    let sawError = false;
    let stepTextSeen = false;
    let emittedStepText = "";
    let toolCallSeen = false;

      for await (const ev of streamChat({
        ctx: opts.ctx,
        runId: agentRunId,
        request: { ...opts.request, messages, tools },
        modelId: opts.modelId,
        cacheKey: opts.cacheKey,
        taskKind: opts.taskKind,
        abortSignal: opts.abortSignal,
        userAgent: opts.userAgent,
        suppressFinalUsageLog: true,
        onFinalUsage: collectFinalUsage,
        telemetry: telemetrySession.port,
      })) {
      if (ev.type === "tool-call") {
        if (!toolCallSeen && emittedStepText) {
          yield { type: "text-retract", text: emittedStepText };
        }
        toolCallSeen = true;
        pendingToolCalls.push({
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
        });
        yield ev; // 透传给 UI
      } else if (ev.type === "finish") {
        stepFinish = ev;
      } else if (ev.type === "error") {
        // 上游/路由错误必须可观察;不发伪造 finish,route 保持 interrupted。
        sawError = true;
        yield ev;
      } else {
        if (ev.type === "text-delta" && ev.text.length > 0) {
          stepTextSeen = true;
          if (toolCallSeen) continue;
          emittedStepText += ev.text;
        }
        yield ev; // text-delta / reasoning-delta / usage 透传
      }
    }

      if (sawError) {
        terminalStatus = "failed";
        return;
      }

    // 无工具调用或模型已结束 → 向外层发唯一最终 finish,完成整个 agent loop。
      if (
        pendingToolCalls.length === 0
        || !stepFinish
        || stepFinish.finishReason !== "tool-calls"
      ) {
        if (pendingToolCalls.length === 0 && stepFinish && hasExecutedTools && !stepTextSeen) {
          summaryAttemptStart = 1;
          break;
        }
        terminalStatus = stepFinish
          ? "success"
          : finalUsages.at(-1)?.params.status ?? "interrupted";
        if (stepFinish) {
          yield { ...stepFinish, usage: aggregateUsage };
        }
        return;
      }

    // 执行工具并收集结果。本轮全部 tool_calls 必须归属于同一条 assistant 消息。
    // 本轮 finish 已消费为循环控制信号,不向外 yield。
      const executeToolCall = async (tc: (typeof pendingToolCalls)[number]) => {
        try {
          return opts.webSearchTool?.definition.function.name === tc.toolName
            ? await opts.webSearchTool.execute(tc.toolCallId, tc.args)
            : await callMcpTool(mcpServers, tc.toolCallId, tc.toolName, tc.args);
        } catch (error) {
          if (opts.abortSignal?.aborted) throw error;
          return {
            result: redactErrorMessage(error, [], "tool_error"),
            isError: true,
          };
        }
      };
      const allWebSearchCalls = pendingToolCalls.length > 1
        && pendingToolCalls.every((tc) => opts.webSearchTool?.definition.function.name === tc.toolName);
      const executions: { result: unknown; isError: boolean }[] = [];
      if (allWebSearchCalls) {
        const maxParallelSearches = 3;
        for (let i = 0; i < pendingToolCalls.length; i += maxParallelSearches) {
          executions.push(...await Promise.all(
            pendingToolCalls.slice(i, i + maxParallelSearches).map(executeToolCall),
          ));
        }
      } else {
        for (const tc of pendingToolCalls) executions.push(await executeToolCall(tc));
      }
      const toolMessages: IRMessage[] = [];
      for (let i = 0; i < pendingToolCalls.length; i += 1) {
        const tc = pendingToolCalls[i];
        const execution = executions[i];
        const { result, isError } = execution;
        yield {
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          result,
          isError,
        };
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.toolCallId,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
      hasExecutedTools = true;
      messages = [
        ...messages,
        {
          role: "assistant",
          content: "",
          tool_calls: pendingToolCalls.map((tc) => ({
            id: tc.toolCallId,
            type: "function",
            function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
          })),
        },
        ...toolMessages,
      ];
    }

    if (maxSteps > 0) {
      let finalFinish: Extract<StreamEvent, { type: "finish" }> | null = null;
      let sawFinalError = false;
      let finalTextSeen = false;
      for (
        let summaryAttempt = summaryAttemptStart;
        summaryAttempt < 2;
        summaryAttempt += 1
      ) {
        const summaryMessages = summaryAttempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "user" as const,
                content: "请基于以上搜索结果直接给出最终回答，不要再次调用工具。",
              },
            ];
        finalFinish = null;
        sawFinalError = false;
        finalTextSeen = false;
        for await (const ev of streamChat({
          ctx: opts.ctx,
          runId: agentRunId,
          request: { ...opts.request, messages: summaryMessages, tools: undefined },
          modelId: opts.modelId,
          cacheKey: opts.cacheKey,
          taskKind: opts.taskKind,
          abortSignal: opts.abortSignal,
          userAgent: opts.userAgent,
          suppressFinalUsageLog: true,
          onFinalUsage: collectFinalUsage,
          telemetry: telemetrySession.port,
        })) {
          if (ev.type === "finish") {
            finalFinish = ev;
          } else if (ev.type === "error") {
            sawFinalError = true;
            yield ev;
          } else {
            if (ev.type === "text-delta" && ev.text.length > 0) finalTextSeen = true;
            yield ev;
          }
        }
        if (finalTextSeen || sawFinalError || opts.abortSignal?.aborted) break;
      }

      if (opts.abortSignal?.aborted) {
        terminalStatus = "interrupted";
        return;
      }
      if (sawFinalError) {
        terminalStatus = "failed";
        return;
      }
      terminalStatus = finalFinish && finalTextSeen ? "success" : "interrupted";
      if (finalFinish) {
        if (finalTextSeen) {
          yield { ...finalFinish, usage: aggregateUsage };
        } else {
          yield {
            type: "error",
            error: "最终回答为空",
          };
        }
      }
      return;
    }
  } catch (err) {
    if (delegatedToPlainStream) throw err;
    terminalError = err;
    terminalStatus = opts.abortSignal?.aborted ? "interrupted" : "failed";
    shouldLogAgentUsage = true;
    throw err;
  } finally {
    if (shouldLogAgentUsage) {
      await telemetrySession.finalize(terminalStatus, terminalError, aggregateUsage, firstTokenAt);
    }
  }
  // maxSteps=0 不执行模型请求，由 finally 记录 interrupted。
}

function createAgentTelemetrySession(
  opts: StreamChatWithToolsOptions,
  requestId: string,
  startedAt: number,
) {
  const executionId = crypto.randomUUID();
  const initial: StartExecutionTelemetry = {
    executionId,
    requestId,
    operation: "chat.stream",
    ctx: opts.ctx,
    model: opts.request.model,
    modelId: opts.modelId,
    requestPath: opts.ctx.source === "gateway" ? "/v1/chat/completions" : undefined,
    stream: true,
    taskKind: opts.taskKind,
    startedAt,
  };
  let started = false;
  let attempt = 0;
  let lastOutcome: GatewayExecutionOutcome<void> | undefined;

  const ensureStarted = async () => {
    if (started) return;
    started = true;
    await gatewayTelemetry.startExecution(initial);
  };

  const port: GatewayTelemetryPort = {
    async startExecution() {
      await ensureStarted();
    },
    async recordAttempt(input) {
      await ensureStarted();
      attempt += 1;
      await gatewayTelemetry.recordAttempt({
        ...input,
        executionId,
        attempt,
      });
    },
    async finalizeExecution(input) {
      lastOutcome = input.outcome as GatewayExecutionOutcome<void>;
    },
  };

  return {
    port,
    async finalize(
      status: LogUsageParams["status"],
      terminalError: unknown,
      usage: IRUsage,
      firstTokenAt?: number,
    ) {
      await ensureStarted();
      const failed = status === "failed";
      const errorMessage = failed
        ? lastOutcome?.error?.message ?? redactErrorMessage(terminalError, [], "生成失败")
        : undefined;
      const errorCode = failed
        ? lastOutcome?.error?.code ?? "generation_failed"
        : status === "interrupted" ? "interrupted" : undefined;
      const completedAt = Date.now();
      await gatewayTelemetry.finalizeExecution({
        initial,
        outcome: {
          executionId,
          status,
          usage,
          route: lastOutcome?.route,
          upstreamKeyMasked: lastOutcome?.upstreamKeyMasked,
          error: errorCode ? {
            code: errorCode,
            message: errorMessage ?? errorCode,
            phase: failed
              ? lastOutcome?.error?.phase ?? classifyError({ errorCode }).phase
              : "internal",
            httpStatus: lastOutcome?.error?.httpStatus,
          } : undefined,
          committed: lastOutcome?.committed ?? false,
        },
        latencyMs: completedAt - startedAt,
        firstTokenLatencyMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
        completedAt,
      });
    },
  };
}

function addUsage(total: IRUsage, usage: IRUsage): IRUsage {
  return {
    inputTokens: (total.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (usage.totalTokens ?? 0),
    reasoningTokens: (total.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
    cachedInputTokens: (total.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
  };
}
