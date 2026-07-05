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
import { streamText, generateText } from "ai";
import { resolveRoutes, RoutingError } from "@/lib/routing";
import { buildLanguageModelWithKey } from "@/lib/providers/registry";
import { orderedWeightedKeys } from "@/lib/providers/keys";
import { recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import { logUsage } from "@/lib/usage";
import type {
  CallContext,
  IRRequest,
  IRMessage,
  StreamEvent,
  IRUsage,
  ResolvedRoute,
} from "@/lib/providers/types";

export interface StreamChatOptions {
  ctx: CallContext;
  request: IRRequest;
  /** 标识一次生成(WebChat 传入 message 的 run_id;网关自动生成)。 */
  runId?: string;
}

/** 判断错误是否值得路由级故障转移(连接/5xx/限流类),而非确定性失败。 */
export function isFailoverableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  // 参数/模型类错误通常对所有路由都一样,不转移。
  if (/model_not_found|invalid_request|context.*length/i.test(msg)) {
    return false;
  }
  return true; // 连接/超时/5xx/限流/认证 → 转移(认证类由 key 级先处理)
}

/** 判断错误是否像是"该 key 无效"(应换 key 重试,而非判定整个 provider 不可用)。 */
export function isKeyAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return /invalid_api_key|authentication|incorrect.*api.*key|401|403/i.test(msg);
}

/**
 * 执行一次流式生成。async generator,产出 StreamEvent。
 *
 * 用法(WebChat):  for await (const ev of streamChat({ ctx, request })) { ... }
 * 用法(网关):    把事件转成 OpenAI SSE 帧。
 */
export async function* streamChat(
  opts: StreamChatOptions,
): AsyncGenerator<StreamEvent, void, unknown> {
  const { ctx, request, runId = `run_${crypto.randomUUID()}` } = opts;
  const startedAt = Date.now();
  let finalUsage: IRUsage = {};
  let usedRoute: ResolvedRoute | undefined;

  // 活跃流式连接计数(metrics)。惰性加载,metrics 不可用时降级为 no-op。
  let releaseStream: () => void = () => {};
  try {
    const m = await import("@/lib/infra/metrics");
    m.acquireStream();
    releaseStream = m.releaseStream;
  } catch {
    /* metrics 不可用,忽略 */
  }

  // 1. 解析路由链
  let routes: ResolvedRoute[];
  try {
    routes = await resolveRoutes(ctx, request.model);
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : "路由解析失败",
      code: err instanceof RoutingError ? err.code : "routing_error",
    };
    await logUsage({
      ctx, runId, model: request.model, usage: {},
      latencyMs: Date.now() - startedAt, status: "failed", errorCode: "routing_error",
    });
    return;
  }

  // 2. 逐条路由尝试(故障转移);路由内再按 key 加权顺序重试(认证类错误换 key)
  let lastError: unknown = null;
  let succeeded = false;
  try {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      usedRoute = route;

      // 路由内 key 尝试序列:加权随机打乱,权重高的先试。
      const keySeq = orderedWeightedKeys(route.provider.keys);

      let routeDone = false;
      for (let k = 0; k < keySeq.length; k++) {
        const tryKey = keySeq[k].key;
        try {
          for await (const ev of streamWithRoute(route, request, tryKey)) {
            yield ev;
            if (ev.type === "finish") finalUsage = ev.usage;
          }
          succeeded = true;
          routeDone = true;
          // 成功 → 重置该 provider 的熔断器(closed)。
          if (route.provider.id) recordSuccess(route.provider.id);
          break; // 正常完成
        } catch (err) {
          lastError = err;
          // 认证/key 类错误:还有备选 key → 换 key 重试(不跨路由)。
          const hasMoreKeys = k < keySeq.length - 1;
          if (isKeyAuthError(err) && hasMoreKeys) {
            console.warn(
              `[streamChat] key 重试 ${k + 2}/${keySeq.length} (model=${route.upstreamModelName}):`,
              err instanceof Error ? err.message : err,
            );
            continue;
          }
          // 否则跳出 key 循环,交由路由级故障转移判定。
          break;
        }
      }
      if (succeeded || routeDone) break;

      // 路由级故障转移。可转移错误(连接/5xx/限流)→ 上报熔断器,尝试下一条。
      if (i === routes.length - 1 || !isFailoverableError(lastError)) break;
      if (route.provider.id) recordFailure(route.provider.id);
      console.warn(
        `[streamChat] 路由转移 ${i + 1}/${routes.length} (model=${route.upstreamModelName}):`,
        lastError instanceof Error ? lastError.message : lastError,
      );
    }

    if (!succeeded) {
      const errMsg = lastError instanceof Error ? lastError.message : "生成失败";
      yield { type: "error", error: errMsg, code: "generation_failed" };
    }
  } finally {
    releaseStream();
    // try/finally 兜底:无论成功/失败/中断,都记录一条用量。
    await logUsage({
      ctx,
      runId,
      model: request.model,
      providerRef: usedRoute ? `${usedRoute.source}:${usedRoute.provider.id}` : undefined,
      usage: finalUsage,
      latencyMs: Date.now() - startedAt,
      status: succeeded ? "success" : "failed",
      errorCode: succeeded ? undefined : "generation_failed",
    });
  }
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
  messages: IRMessage[];
} {
  const systemMessages = request.messages.filter((m) => m.role === "system");
  const dialogueMessages = request.messages.filter((m) => m.role !== "system");
  if (dialogueMessages.length === 0) {
    throw new Error("消息无效:缺少用户消息,无法生成回复");
  }
  const system =
    systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n\n") || undefined;
  return { system, messages: dialogueMessages };
}

/** 用单条路由 + 指定 key 执行 streamText,产出统一事件。用量由调用方在 finish 事件后记录。 */
async function* streamWithRoute(
  route: ResolvedRoute,
  request: IRRequest,
  apiKey: string,
): AsyncGenerator<StreamEvent, void, unknown> {
  const model = buildLanguageModelWithKey(route, apiKey); // 失败则抛出,交由上层故障转移
  const { system, messages } = separateSystem(request);

  const result = streamText({
    model,
    instructions: system,
    messages: messages as never,
    temperature: request.temperature,
    maxOutputTokens: request.max_tokens,
    topP: request.top_p,
    // P1-A:工具(MCP)透传给上游模型。tools 格式已是 OpenAI function-calling 兼容。
    tools: request.tools as unknown as Parameters<typeof streamText>[0]["tools"],
  });

  // 用 fullStream 捕获 tool-call 增量(若 tools 存在),否则纯文本。
  for await (const part of result.stream) {
    switch (part.type) {
      case "text-delta":
        yield { type: "text-delta", text: part.text };
        break;
      case "reasoning-delta":
        // 推理增量(如 deepseek-r1/Claude thinking)透传给 UI。
        yield { type: "reasoning-delta", text: part.text };
        break;
      case "tool-call":
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
  const irUsage: IRUsage = {
    inputTokens: finalUsage.inputTokens,
    outputTokens: finalUsage.outputTokens,
    totalTokens: finalUsage.totalTokens,
    reasoningTokens: finalUsage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: finalUsage.inputTokenDetails?.cacheReadTokens,
  };
  yield { type: "finish", finishReason: await result.finishReason, usage: irUsage };
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

/**
 * 非流式生成。与 streamChat 共享路由解析、key 加权、熔断、用量记录,
 * 但内部用 generateText 一次性返回(不产出可见 reasoning,thinking 默认关闭)。
 *
 * 适用于标题生成、记忆抽取等「只要最终文本」的轻量副任务。
 */
export async function generateChat(opts: StreamChatOptions): Promise<GenerateChatResult> {
  const { ctx, request, runId = `run_${crypto.randomUUID()}` } = opts;
  const startedAt = Date.now();
  let finalUsage: IRUsage = {};
  let usedRoute: ResolvedRoute | undefined;

  // metrics 惰性降级,与 streamChat 一致。
  let releaseStream: () => void = () => {};
  try {
    const m = await import("@/lib/infra/metrics");
    m.acquireStream();
    releaseStream = m.releaseStream;
  } catch {
    /* metrics 不可用,忽略 */
  }

  let routes: ResolvedRoute[];
  try {
    routes = await resolveRoutes(ctx, request.model);
  } catch (err) {
    await logUsage({
      ctx, runId, model: request.model, usage: {},
      latencyMs: Date.now() - startedAt, status: "failed", errorCode: "routing_error",
    });
    return { text: "", error: err instanceof Error ? err.message : "路由解析失败" };
  }

  let lastError: unknown = null;
  let succeeded = false;
  let text = "";
  try {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      usedRoute = route;
      const keySeq = orderedWeightedKeys(route.provider.keys);

      let routeDone = false;
      for (let k = 0; k < keySeq.length; k++) {
        const tryKey = keySeq[k].key;
        try {
          const model = buildLanguageModelWithKey(route, tryKey);
          const { system, messages } = separateSystem(request);
          const result = await generateText({
            model,
            instructions: system,
            messages: messages as never,
            temperature: request.temperature,
            maxOutputTokens: request.max_tokens,
            topP: request.top_p,
          });
          text = result.text;
          const u = result.usage;
          finalUsage = {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens,
            reasoningTokens: u.outputTokenDetails?.reasoningTokens,
            cachedInputTokens: u.inputTokenDetails?.cacheReadTokens,
          };
          succeeded = true;
          routeDone = true;
          if (route.provider.id) recordSuccess(route.provider.id);
          break;
        } catch (err) {
          lastError = err;
          const hasMoreKeys = k < keySeq.length - 1;
          if (isKeyAuthError(err) && hasMoreKeys) continue;
          break;
        }
      }
      if (succeeded || routeDone) break;

      if (i === routes.length - 1 || !isFailoverableError(lastError)) break;
      if (route.provider.id) recordFailure(route.provider.id);
      console.warn(
        `[generateChat] 路由转移 ${i + 1}/${routes.length} (model=${route.upstreamModelName}):`,
        lastError instanceof Error ? lastError.message : lastError,
      );
    }

    if (!succeeded) {
      const errMsg = lastError instanceof Error ? lastError.message : "生成失败";
      return { text: "", usage: finalUsage, error: errMsg };
    }
    return { text, usage: finalUsage };
  } finally {
    releaseStream();
    await logUsage({
      ctx,
      runId,
      model: request.model,
      providerRef: usedRoute ? `${usedRoute.source}:${usedRoute.provider.id}` : undefined,
      usage: finalUsage,
      latencyMs: Date.now() - startedAt,
      status: succeeded ? "success" : "failed",
      errorCode: succeeded ? undefined : "generation_failed",
    });
  }
}

// ===========================================================================
// P1-A:Agent loop —— 多轮工具调用(MCP)
// ===========================================================================

export interface StreamChatWithToolsOptions extends StreamChatOptions {
  /** 允许的最大工具调用轮数(默认 5)。 */
  maxSteps?: number;
  /** 已解析的 MCP server(含工具清单 + 连接)。 */
  mcpServers?: import("@/lib/mcp/registry").ResolvedMcpServer[];
}

/**
 * 带 agent loop 的流式生成:模型调工具 → 执行 → 回填 → 继续,直到模型不再调工具。
 * 复用 streamChat 做单步生成,callMcpTool 执行工具。
 * 透传全部 StreamEvent(text-delta / tool-call / tool-result / finish / error)。
 */
export async function* streamChatWithTools(
  opts: StreamChatWithToolsOptions,
): AsyncGenerator<import("@/lib/providers/types").StreamEvent, void, unknown> {
  const { maxSteps = 5, mcpServers = [] } = opts;
  // 合并工具集(来自 MCP)。
  let tools = opts.request.tools;
  if (mcpServers.length > 0) {
    const { toIRTools } = await import("@/lib/mcp/registry");
    tools = [...(tools ?? []), ...toIRTools(mcpServers)];
  }
  if (!tools || tools.length === 0) {
    // 无工具:退化为普通 streamChat。
    yield* streamChat(opts);
    return;
  }

  const { callMcpTool } = await import("@/lib/mcp/registry");
  // working messages:每轮追加 tool 结果,进入下一轮。
  let messages = [...opts.request.messages];

  for (let step = 0; step < maxSteps; step++) {
    const pendingToolCalls: {
      toolCallId: string;
      toolName: string;
      args: unknown;
    }[] = [];
    let lastFinishReason = "stop";

    for await (const ev of streamChat({
      ctx: opts.ctx,
      runId: opts.runId,
      request: { ...opts.request, messages, tools },
    })) {
      if (ev.type === "tool-call") {
        pendingToolCalls.push({
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
        });
        yield ev; // 透传给 UI
      } else if (ev.type === "finish") {
        lastFinishReason = ev.finishReason;
        // finish 也透传(每轮一个 finish 事件,UI 可选展示)。
      } else if (ev.type !== "error") {
        yield ev; // text-delta / usage 透传
      }
    }

    // 无工具调用或模型已结束 → 完成整个 agent loop。
    if (pendingToolCalls.length === 0 || lastFinishReason !== "tool-calls") {
      return;
    }

    // 执行工具,把结果作为 tool message 追加,进入下一轮。
    for (const tc of pendingToolCalls) {
      const { result, isError } = await callMcpTool(
        mcpServers, tc.toolCallId, tc.toolName, tc.args,
      ).catch((e) => ({
        result: e instanceof Error ? e.message : "tool_error",
        isError: true,
      }));
      yield {
        type: "tool-result",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        result,
        isError,
      };
      // 追加 assistant 的 tool_call + 对应 tool 结果(OpenAI 多轮格式)。
      messages = [
        ...messages,
        {
          role: "assistant" as const,
          content: "",
          tool_calls: [{ id: tc.toolCallId, type: "function", function: { name: tc.toolName, arguments: JSON.stringify(tc.args) } }],
        },
        {
          role: "tool" as const,
          tool_call_id: tc.toolCallId,
          content: typeof result === "string" ? result : JSON.stringify(result),
        },
      ];
    }
  }
}
