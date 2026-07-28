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
import { streamText, generateText, Output, type ModelMessage } from "ai";
import { resolveRoutes, resolveRoutesById, RoutingError } from "@/lib/routing";
import { buildLanguageModelWithKey } from "@/lib/providers/registry";
import { getChatUA } from "@/lib/system-settings/ua";
import { orderedWeightedKeys } from "@/lib/providers/keys";
import { recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import { logUsage, maskKey, type LogUsageParams } from "@/lib/usage";
import { classifyError, NETWORK_KEYWORDS } from "@/lib/error-classify";
import { redactErrorMessage, redactSensitiveText } from "@/lib/redaction";
import { buildReasoningProviderOptions, getDefaultReasoningLevel } from "@/lib/reasoning";
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
  /** 副任务类型(title/memory/compact);主回复 / 网关请求不传 → null。 */
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
}

interface StreamChatFinalUsage {
  params: LogUsageParams;
  firstTokenAt?: number;
}

function reportFinalUsage(
  opts: StreamChatOptions,
  result: StreamChatFinalUsage,
): Promise<void> | void {
  if (opts.suppressFinalUsageLog) {
    opts.onFinalUsage?.(result);
    return;
  }
  return logUsage(result.params);
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
 * 判断错误是否值得在同 provider 内换 key 重试。
 *
 * 同一 provider 下的多个 key 通常共享上游但独立计费/限流,因此:
 *   - 认证类(401/403):该 key 无效,换 key 有意义。
 *   - 限流(429):不同 key 独立限流窗口,换 key 有意义。
 *   - 连接/超时/5xx:偶发上游故障,换 key 重试成本低收益高。
 * 请求本身的确定性错误(model_not_found/invalid_request/context_length)
 * 换 key 也会失败,不重试--由 isFailoverableError 统一排除。
 */
export function isRetryableForKey(err: unknown): boolean {
  if (isKeyAuthError(err)) return true;
  // 429 限流:不同 key 独立限流窗口。复刻 classifyStreamError 的 statusCode 提取
  // (RetryError.lastError / 直接 statusCode),避免依赖错误类 import。
  const lastError = (err as { lastError?: unknown } | null)?.lastError;
  const source = (lastError ?? err) as { statusCode?: number };
  if (typeof source?.statusCode === "number" && source.statusCode === 429) return true;
  // 其余按路由级可转移判定(已排除 model_not_found/invalid_request/context_length)。
  return isFailoverableError(err);
}

/** 同 provider 内换 key 重试的总尝试次数上限(含首次)。避免 key 过多时单请求撞太多次上游。 */
const MAX_KEY_ATTEMPTS = 6;

/** 判断错误是否是主动中止(abortSignal 触发)。中止不重试 key、不转移路由,用量记 interrupted。 */
export function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /this operation was aborted|aborted/i.test(msg);
}

/**
 * stream 内部短码 → HTTP 状态码(失败落库 httpStatus 用)。
 * 与 error-classify 的短码收录对齐;不动 errorCode 字面值(保护历史数据 + 分类)。
 * 路由层失败兜底 503,生成失败 502,未知兜底 500。
 */
const SHORT_HTTP_STATUS: Record<string, number> = {
  generation_failed: 502,
  routing_error: 503,
  model_not_found: 404,
  model_not_available: 404,
  model_not_bound: 403,
  no_route: 503,
  capability_not_supported: 400,
  // stream.ts 按真实上游 statusCode 提取的细码(与 error-classify ERROR_CODE_MAP 对齐)。
  rate_limited: 429,
  auth_error: 401,
  upstream_error: 502,
  network_error: 503,
};

function providerSecrets(route: ResolvedRoute, apiKey: string): string[] {
  return [apiKey, ...Object.values(route.provider.headers ?? {})];
}

/**
 * 从生成错误提取真实上游 statusCode 与分类短码,供落库 httpStatus/errorCode/errorPhase 使用。
 *
 * AI SDK 的 RetryError(maxRetriesExceeded)把真实错误包在 lastError(AI_APICallError 带 statusCode);
 * 直接抛出的 AI_APICallError 自带 statusCode。duck-typing 提取,不依赖错误类 import。
 * 优先按真实 statusCode 分类(429/401/403/5xx),无 statusCode 时按 message 网络关键字,最后兜底 generation_failed。
 */
export function classifyStreamError(
  err: unknown,
  secrets: readonly (string | null | undefined)[] = [],
): {
  statusCode?: number;
  errorCode: string;
  message: string;
} {
  // RetryError.lastError 是最后一次真实错误;非 RetryError 则 err 本身即真实错误源。
  const lastError = (err as { lastError?: unknown } | null)?.lastError;
  const source = (lastError ?? err) as { statusCode?: number };
  const statusCode = typeof source?.statusCode === "number" ? source.statusCode : undefined;
  const rawMessage = err instanceof Error ? err.message : err != null ? String(err) : "生成失败";
  const message = redactSensitiveText(rawMessage, secrets);

  if (statusCode === 429) return { statusCode, errorCode: "rate_limited", message };
  if (statusCode === 401 || statusCode === 403) return { statusCode, errorCode: "auth_error", message };
  if (statusCode !== undefined && statusCode >= 500) return { statusCode, errorCode: "upstream_error", message };
  if (NETWORK_KEYWORDS.test(rawMessage)) return { statusCode, errorCode: "network_error", message };
  // 其余(400/404/402 等 4xx 或无 statusCode 的未知错误):归 generation_failed。
  return { statusCode, errorCode: "generation_failed", message };
}

/**
 * 记录单次 key 尝试失败到 ops_error_logs(方案 X)。
 *
 * 每次换 key / 换路由前的失败各记一条,带递增 attempt 序号,同一 runId 串联。
 * 跳过 metrics 埋点(skipMetrics):一次请求只在最终结果(success/interrupted/failed)
 * 埋一次点,避免中间失败导致 nekusora_requests_total 重复计数。
 * 失败不抛错(日志记录不应阻断故障转移)。
 */
async function logAttemptFailure(opts: {
  ctx: CallContext;
  runId: string;
  model: string;
  route: ResolvedRoute;
  apiKey: string;
  err: unknown;
  attempt: number;
  stream: boolean;
  taskKind?: string;
}): Promise<void> {
  const classified = classifyStreamError(opts.err, providerSecrets(opts.route, opts.apiKey));
  const phase = classifyError({
    errorCode: classified.errorCode,
    httpStatus: classified.statusCode,
    errorMessage: classified.message,
  }).phase;
  await logUsage({
    ctx: opts.ctx,
    runId: opts.runId,
    model: opts.model,
    providerRef: `${opts.route.source}:${opts.route.provider.id}`,
    usage: {},
    // 单次尝试的独立耗时未计量,留 null(前端显示 "-");重试链以 key/错误码为主。
    status: "failed",
    errorCode: classified.errorCode,
    errorMessage: classified.message,
    errorPhase: phase,
    errorType: classified.errorCode,
    httpStatus: classified.statusCode ?? SHORT_HTTP_STATUS[classified.errorCode] ?? 500,
    providerName: opts.route.provider.name,
    routeId: opts.route.routeId,
    routeName: `${opts.route.provider.name} · ${opts.route.upstreamModelName}`,
    upstreamModel: opts.route.upstreamModelName,
    stream: opts.stream,
    taskKind: opts.taskKind,
    upstreamKeyMasked: maskKey(opts.apiKey),
    attempt: opts.attempt,
    skipMetrics: true,
  });
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
  // 首 token 时刻(TTFT)。用 mutable 对象传给 streamWithRoute,使其能在收到首个
  // text-delta / reasoning-delta 时回写;finally 据此计算 firstTokenLatencyMs。
  const timing: { firstTokenAt?: number } = {};
  // 客户端中止标记:命中则跳过故障转移、不发 error 帧,finally 记 interrupted。
  let aborted = false;
  // 正文、推理或工具调用一旦发给客户端就无法撤回,后续失败不得再拼接其他 key/路由的输出。
  let responseCommitted = false;

  // 活跃流式连接计数(metrics)。惰性加载,metrics 不可用时降级为 no-op。
  let releaseStream: () => void = () => {};
  try {
    const m = await import("@/lib/infra/metrics");
    m.acquireStream();
    releaseStream = m.releaseStream;
  } catch {
    /* metrics 不可用,忽略 */
  }

  // 1. 解析路由链(WebChat 传 modelId → byId;网关/副任务缺省 → by name)。
  let routes: ResolvedRoute[];
  try {
    routes = opts.modelId
      ? await resolveRoutesById(ctx, opts.modelId)
      : await resolveRoutes(ctx, request.model);
  } catch (err) {
    const errCode = err instanceof RoutingError ? err.code : "routing_error";
    const errMsg = redactErrorMessage(err, [], "路由解析失败");
    yield { type: "error", error: errMsg, code: errCode };
    await reportFinalUsage(opts, {
      params: {
        ctx, runId, model: request.model, usage: {},
        latencyMs: Date.now() - startedAt, status: "failed", errorCode: errCode,
        errorMessage: errMsg,
        errorPhase: classifyError({ errorCode: errCode }).phase,
        errorType: errCode,
        httpStatus: SHORT_HTTP_STATUS[errCode] ?? 503,
        stream: true,
        taskKind: opts.taskKind,
        upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey),
      },
    });
    return;
  }

  // 2. 逐条路由尝试(故障转移);路由内再按 key 加权顺序重试(认证类错误换 key)
  let lastError: unknown = null;
  let lastSafeError = "生成失败";
  let succeeded = false;
  // 尝试序号(跨路由连续递增):每次 key 失败记一条 ops_error_logs(attempt=N),供前端重试链排序。
  let attemptCount = 0;
  try {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      usedRoute = route;

      // 路由内 key 尝试序列:加权随机打乱,权重高的先试。
      const keySeq = orderedWeightedKeys(route.provider.keys);
      // 换 key 重试上限:总尝试次数 ≤ MAX_KEY_ATTEMPTS(key 过多时只试权重高的前若干个)。
      const maxAttempts = Math.min(keySeq.length, MAX_KEY_ATTEMPTS);

      let routeDone = false;
      for (let k = 0; k < maxAttempts; k++) {
        const tryKey = keySeq[k].key;
        try {
          for await (const ev of streamWithRoute(route, request, tryKey, timing, opts.cacheKey, opts.abortSignal, opts.userAgent)) {
            if (ev.type === "text-delta" || ev.type === "reasoning-delta" || ev.type === "tool-call") {
              responseCommitted = true;
            }
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
          lastSafeError = redactErrorMessage(
            err,
            providerSecrets(route, tryKey),
            "生成失败",
          );
          // 客户端中止:不重试 key、不转移路由,直接结束(用量记 interrupted)。
          if (isAbortError(err)) {
            aborted = true;
            break;
          }
          // 方案 X:每次尝试失败各记一条 ops_error_logs(带 attempt,不走 metrics)。
          // 不管后续是否换 key/换路由,这次失败都已发生,独立落库。
          attemptCount += 1;
          await logAttemptFailure({
            ctx, runId, model: request.model, route, apiKey: tryKey,
            err, attempt: attemptCount, stream: true, taskKind: opts.taskKind,
          });
          // 可换 key 重试的错误(认证/限流/连接/5xx)+ 还有尝试额度 -> 换 key 重试(不跨路由)。
          // 请求本身的确定性错误(model_not_found/invalid_request/context_length)不换 key。
          const hasMoreAttempts = k < maxAttempts - 1;
          if (!responseCommitted && hasMoreAttempts && isRetryableForKey(err)) {
            console.warn(
              `[streamChat] key 重试 ${k + 2}/${maxAttempts} (model=${route.upstreamModelName}):`,
              lastSafeError,
            );
            continue;
          }
          // 否则跳出 key 循环,交由路由级故障转移判定。
          break;
        }
      }
      if (succeeded || routeDone || aborted) break;

      // 路由级故障转移。可转移错误(连接/5xx/限流)→ 上报熔断器,尝试下一条。
      const failoverable = isFailoverableError(lastError);
      if (failoverable && route.provider.id) recordFailure(route.provider.id);
      if (responseCommitted || i === routes.length - 1 || !failoverable) break;
      console.warn(
        `[streamChat] 路由转移 ${i + 1}/${routes.length} (model=${route.upstreamModelName}):`,
        lastSafeError,
      );
    }

    if (!succeeded && !aborted) {
      yield { type: "error", error: lastSafeError, code: "generation_failed" };
    }
  } finally {
    releaseStream();
    // 首 token 延迟(TTFT):仅有首 token 产出时才有值;路由解析失败 / 全路由失败 / 未产出首 token -> undefined。
    const firstTokenLatencyMs =
      timing.firstTokenAt !== undefined ? timing.firstTokenAt - startedAt : undefined;
    if (succeeded || aborted) {
      // 成功 / 中断:记最终结果(usage_logs 或 ops_error_logs interrupted)+ metrics 埋点。
      await reportFinalUsage(opts, {
        params: {
          ctx,
          runId,
          model: request.model,
          providerRef: usedRoute ? `${usedRoute.source}:${usedRoute.provider.id}` : undefined,
          usage: finalUsage,
          latencyMs: Date.now() - startedAt,
          status: succeeded ? "success" : "interrupted",
          // 路由可读信息快照(provider 改名不影响历史行)。
          providerName: usedRoute?.provider.name,
          routeId: usedRoute?.routeId,
          routeName: usedRoute
            ? `${usedRoute.provider.name} · ${usedRoute.upstreamModelName}`
            : undefined,
          upstreamModel: usedRoute?.upstreamModelName,
          firstTokenLatencyMs,
          stream: true,
          taskKind: opts.taskKind,
          upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey),
        },
        firstTokenAt: timing.firstTokenAt,
      });
    } else {
      if (opts.suppressFinalUsageLog) {
        await reportFinalUsage(opts, {
          params: {
            ctx,
            runId,
            model: request.model,
            providerRef: usedRoute ? `${usedRoute.source}:${usedRoute.provider.id}` : undefined,
            usage: finalUsage,
            latencyMs: Date.now() - startedAt,
            status: "failed",
            errorCode: "generation_failed",
            errorMessage: lastSafeError,
            errorPhase: classifyError({ errorCode: "generation_failed" }).phase,
            errorType: "generation_failed",
            stream: true,
            taskKind: opts.taskKind,
            upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey),
          },
          firstTokenAt: timing.firstTokenAt,
        });
        return;
      }
      // 方案 X:每次尝试失败已在 catch 记 ops_error_logs(attempt=1..N),此处不重复记库,只补 metrics 埋点。
      try {
        const { observeRequest } = await import("@/lib/infra/metrics");
        observeRequest({
          source: ctx.source,
          model: request.model,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          promptTokens: finalUsage.inputTokens ?? 0,
          completionTokens: finalUsage.outputTokens ?? 0,
        });
      } catch {
        /* metrics 不可用,忽略 */
      }
    }
  }
}

/** 在 AI SDK 边界把 OpenAI 图片 part 转为 ModelMessage 文件 part。 */
export function toModelMessages(messages: IRMessage[]): ModelMessage[] {
  return messages.map((message) => {
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
  return { system, messages: toModelMessages(dialogueMessages) };
}

/** 用单条路由 + 指定 key 执行 streamText,产出统一事件。用量由调用方在 finish 事件后记录。 */
async function* streamWithRoute(
  route: ResolvedRoute,
  request: IRRequest,
  apiKey: string,
  /** 首 token 计时载体(mutable,由调用方持有;首个文本/推理增量时回写 firstTokenAt)。 */
  timing: { firstTokenAt?: number },
  /** 会话级 cache key(chat=conversationId / 网关=apiKeyId);缺省不注入缓存控制。 */
  cacheKey?: string,
  /** 中止信号:透传给 streamText,客户端断开时中止上游 fetch,避免写已关闭 socket。 */
  abortSignal?: AbortSignal,
  /** 上游请求 User-Agent(覆盖 AI SDK 默认 UA)。 */
  userAgent?: string,
): AsyncGenerator<StreamEvent, void, unknown> {
  const reasoning = request.reasoning ?? getDefaultReasoningLevel(route.capabilities);
  const model = buildLanguageModelWithKey(route, apiKey, cacheKey, reasoning, userAgent); // 失败则抛出,交由上层故障转移
  const { system, messages } = separateSystem(request);

  // 按 protocol 注入 prompt 缓存控制(复刻 pi 兜底策略):
  //  - anthropic:system + 末条消息打 cache_control 断点(上游靠显式断点缓存)
  //  - openai:promptCacheKey(prompt_cache_key)辅助路由命中
  //  - openai-compatible:session affinity header 在 registry 注入,此处不处理
  const wantsCache = !!cacheKey;
  const isAnthropic = route.protocol === "anthropic";
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
  const cacheProviderOptions = route.protocol === "openai" && cacheKey ? { openai: { promptCacheKey: cacheKey } } : {};

  const result = streamText({
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
    // AI SDK SharedV4ProviderOptions 类型摩擦,沿用本文件 messages/tools 的 as never 处理。
    providerOptions: {
      ...(route.protocol === "openai-compatible"
        ? undefined
        : buildReasoningProviderOptions(route.protocol, route.capabilities, reasoning)),
      ...cacheProviderOptions,
    } as never,
    // P1-A:工具(MCP)透传给上游模型。tools 格式已是 OpenAI function-calling 兼容。
    tools: request.tools as unknown as Parameters<typeof streamText>[0]["tools"],
    // 客户端断开时中止上游 fetch,避免继续写已关闭 socket → uncaughtException。
    abortSignal,
  });

  // 用 fullStream 捕获 tool-call 增量(若 tools 存在),否则纯文本。
  for await (const part of result.stream) {
    switch (part.type) {
      case "text-delta":
        // 首 token 采样:仅首次 text-delta 时记录(后续 delta 不覆盖)。
        if (timing.firstTokenAt === undefined) timing.firstTokenAt = Date.now();
        yield { type: "text-delta", text: part.text };
        break;
      case "reasoning-delta":
        // 首 token 采样:推理增量也算首 token(部分模型先吐 reasoning 再吐正文)。
        if (timing.firstTokenAt === undefined) timing.firstTokenAt = Date.now();
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

export interface GenerateChatOptions extends StreamChatOptions {
  /** 副任务需要结构化 JSON 时启用;缺省保持普通文本。 */
  output?: "text" | "json";
}

/**
 * 非流式生成。与 streamChat 共享路由解析、key 加权、熔断、用量记录,
 * 但内部用 generateText 一次性返回(不产出可见 reasoning,thinking 默认关闭)。
 *
 * 适用于标题生成、记忆抽取等「只要最终文本」的轻量副任务。
 */
export async function generateChat(opts: GenerateChatOptions): Promise<GenerateChatResult> {
  const { ctx, request, runId = `run_${crypto.randomUUID()}` } = opts;
  const startedAt = Date.now();
  // 副任务统一用聊天 UA(opts.userAgent 缺省时读配置);注入 registry customFetch 覆盖 AI SDK 默认 UA。
  const chatUA = opts.userAgent ?? await getChatUA();
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
    routes = opts.modelId
      ? await resolveRoutesById(ctx, opts.modelId)
      : await resolveRoutes(ctx, request.model);
  } catch (err) {
    const errCode = err instanceof RoutingError ? err.code : "routing_error";
    const errMsg = redactErrorMessage(err, [], "路由解析失败");
    await logUsage({
      ctx, runId, model: request.model, usage: {},
      latencyMs: Date.now() - startedAt, status: "failed", errorCode: errCode,
      errorMessage: errMsg,
      errorPhase: classifyError({ errorCode: errCode }).phase,
      errorType: errCode,
      httpStatus: SHORT_HTTP_STATUS[errCode] ?? 503,
      stream: false,
      taskKind: opts.taskKind,
      upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey),
    });
    return { text: "", error: errMsg };
  }

  let lastError: unknown = null;
  let lastSafeError = "生成失败";
  let succeeded = false;
  let text = "";
  // 尝试序号(跨路由连续递增):每次 key 失败记一条 ops_error_logs(attempt=N),供前端重试链排序。
  let attemptCount = 0;
  try {
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      usedRoute = route;
      const keySeq = orderedWeightedKeys(route.provider.keys);
      const maxAttempts = Math.min(keySeq.length, MAX_KEY_ATTEMPTS);

      let routeDone = false;
      for (let k = 0; k < maxAttempts; k++) {
        const tryKey = keySeq[k].key;
        try {
          const model = buildLanguageModelWithKey(route, tryKey, undefined, undefined, chatUA);
          const { system, messages } = separateSystem(request);
          const result = await generateText({
            model,
            // 禁用 AI SDK 自动重试,理由同 streamWithRoute(429 不放大、5xx 不施压),故障转移由上层接管。
            maxRetries: 0,
            instructions: system,
            messages,
            temperature: request.temperature,
            maxOutputTokens: request.max_tokens,
            topP: request.top_p,
            // Mem0 等后台任务要求 JSON object;由 AI SDK 统一翻译到各 provider。
            output: opts.output === "json" ? Output.json() : undefined,
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
          lastSafeError = redactErrorMessage(
            err,
            providerSecrets(route, tryKey),
            "生成失败",
          );
          // 方案 X:每次尝试失败各记一条 ops_error_logs(带 attempt,不走 metrics)。
          attemptCount += 1;
          await logAttemptFailure({
            ctx, runId, model: request.model, route, apiKey: tryKey,
            err, attempt: attemptCount, stream: false, taskKind: opts.taskKind,
          });
          const hasMoreAttempts = k < maxAttempts - 1;
          if (hasMoreAttempts && isRetryableForKey(err)) continue;
          break;
        }
      }
      if (succeeded || routeDone) break;

      const failoverable = isFailoverableError(lastError);
      if (failoverable && route.provider.id) recordFailure(route.provider.id);
      if (i === routes.length - 1 || !failoverable) break;
      console.warn(
        `[generateChat] 路由转移 ${i + 1}/${routes.length} (model=${route.upstreamModelName}):`,
        lastSafeError,
      );
    }

    if (!succeeded) {
      return { text: "", usage: finalUsage, error: lastSafeError };
    }
    return { text, usage: finalUsage };
  } finally {
    releaseStream();
    if (succeeded) {
      // 成功:记 usage_logs + metrics 埋点。
      await logUsage({
        ctx,
        runId,
        model: request.model,
        providerRef: usedRoute ? `${usedRoute.source}:${usedRoute.provider.id}` : undefined,
        usage: finalUsage,
        latencyMs: Date.now() - startedAt,
        status: "success",
        // 路由可读信息快照。
        providerName: usedRoute?.provider.name,
        routeId: usedRoute?.routeId,
        routeName: usedRoute
          ? `${usedRoute.provider.name} · ${usedRoute.upstreamModelName}`
          : undefined,
        upstreamModel: usedRoute?.upstreamModelName,
        // 非流式 generateText 一次性返回,无首 token 概念,TTFT 恒为 undefined。
        firstTokenLatencyMs: undefined,
        stream: false,
        taskKind: opts.taskKind,
        upstreamKeyMasked: maskKey(usedRoute?.provider.apiKey),
      });
    } else {
      // 方案 X:每次尝试失败已在 catch 记 ops_error_logs(attempt=1..N),此处只补 metrics 埋点(不重复记库)。
      try {
        const { observeRequest } = await import("@/lib/infra/metrics");
        observeRequest({
          source: ctx.source,
          model: request.model,
          status: "failed",
          latencyMs: Date.now() - startedAt,
          promptTokens: finalUsage.inputTokens ?? 0,
          completionTokens: finalUsage.outputTokens ?? 0,
        });
      } catch {
        /* metrics 不可用,忽略 */
      }
    }
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
 *
 * 事件契约:
 *   - text-delta / reasoning-delta / usage / tool-call / tool-result 按发生顺序透传
 *   - 中间轮 streamChat 的 finish 仅用于循环控制,不向外层 yield
 *   - 整个 agent loop 最多向外层发一次最终 finish(usage/finishReason 取最终一轮)
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
  let aggregateUsage: IRUsage = {};
  const finalUsages: StreamChatFinalUsage[] = [];
  let firstTokenAt: number | undefined;
  let terminalStatus: LogUsageParams["status"] = "interrupted";
  let terminalError: unknown;
  let delegatedToPlainStream = false;
  let shouldLogAgentUsage = false;
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
      })) {
      if (ev.type === "tool-call") {
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
        terminalStatus = stepFinish
          ? "success"
          : finalUsages.at(-1)?.params.status ?? "interrupted";
        if (stepFinish) {
          yield stepFinish;
        }
        return;
      }

    // 执行工具并收集结果。本轮全部 tool_calls 必须归属于同一条 assistant 消息。
    // 本轮 finish 已消费为循环控制信号,不向外 yield。
      const toolMessages: IRMessage[] = [];
      for (const tc of pendingToolCalls) {
        const { result, isError } = await callMcpTool(
          mcpServers, tc.toolCallId, tc.toolName, tc.args,
        ).catch((e) => ({
          result: redactErrorMessage(e, [], "tool_error"),
          isError: true,
        }));
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
  } catch (err) {
    if (delegatedToPlainStream) throw err;
    terminalError = err;
    terminalStatus = opts.abortSignal?.aborted ? "interrupted" : "failed";
    shouldLogAgentUsage = true;
    throw err;
  } finally {
    if (shouldLogAgentUsage) {
      const finalUsage = finalUsages.at(-1);
      if (finalUsage) {
        const errorCode = terminalStatus === "success"
          ? finalUsage.params.errorCode
          : terminalStatus === "interrupted"
            ? "interrupted"
            : finalUsage.params.errorCode ?? "generation_failed";
        await logUsage({
          ...finalUsage.params,
          runId: agentRunId,
          usage: aggregateUsage,
          status: terminalStatus,
          errorCode,
          errorMessage: terminalStatus === "failed"
            ? finalUsage.params.errorMessage
              ?? (terminalError == null ? undefined : redactErrorMessage(terminalError))
            : finalUsage.params.errorMessage,
          errorPhase: terminalStatus === "failed"
            ? finalUsage.params.errorPhase ?? classifyError({ errorCode }).phase
            : finalUsage.params.errorPhase,
          errorType: terminalStatus === "success"
            ? finalUsage.params.errorType
            : errorCode,
          latencyMs: Date.now() - startedAt,
          firstTokenLatencyMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
        });
      } else {
        const failed = terminalStatus === "failed";
        await logUsage({
          ctx: opts.ctx,
          runId: agentRunId,
          model: opts.request.model,
          providerRef: undefined,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            reasoningTokens: 0,
            cachedInputTokens: 0,
          },
          latencyMs: Date.now() - startedAt,
          status: terminalStatus,
          errorCode: failed ? "generation_failed" : "interrupted",
          errorMessage: failed
            ? redactErrorMessage(terminalError, [], "生成失败")
            : undefined,
          errorPhase: failed ? classifyError({ errorCode: "generation_failed" }).phase : undefined,
          errorType: failed ? "generation_failed" : "interrupted",
          providerName: undefined,
          routeId: undefined,
          routeName: undefined,
          upstreamModel: undefined,
          firstTokenLatencyMs: undefined,
          stream: true,
          taskKind: opts.taskKind,
          upstreamKeyMasked: undefined,
        });
      }
    }
  }
  // maxSteps 耗尽且仍停在 tool-calls:finally 记 interrupted,不发最终 finish。
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
