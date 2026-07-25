/**
 * OpenAI 兼容网关端点 —— POST /v1/chat/completions
 *
 * 鉴权:Authorization: Bearer sk-xxx → keys.verifyKey()
 * 格式:严格遵循 OpenAI Chat Completions 响应结构。
 *   - stream=true:SSE data: 帧 + [DONE]
 *   - stream=false:单 JSON 响应
 *
 * 复用 streamChat()(阶段 3),把 StreamEvent 转 OpenAI 帧。
 * 用 Node runtime(需查库鉴权 + 流式)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { streamChat } from "@/lib/stream";
import { getGatewayUA } from "@/lib/system-settings/ua";
import { verifyKey, extractBearer } from "@/lib/keys";
import { apiErrorLocalized, ErrorCode, ERROR_META } from "@/lib/errors";
import { classifyError } from "@/lib/error-classify";
import { logUsage } from "@/lib/usage";
import type { IRRequest, CallContext } from "@/lib/providers/types";
import { resolveReasoningLevel } from "@/lib/reasoning";

export const runtime = "nodejs";
// 禁用响应缓冲,保证 SSE 实时推送(Next.js 网关关键坑)。
export const dynamic = "force-dynamic";

/** 请求路径常量(错误日志 requestPath 用)。 */
const REQUEST_PATH = "/v1/chat/completions";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  // 1. 鉴权
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) {
    await logRouteError({ startedAt, code: ErrorCode.AUTH_MISSING_KEY });
    return apiErrorLocalized(ErrorCode.AUTH_MISSING_KEY, req);
  }
  const verified = await verifyKey(rawKey);
  if (!verified) {
    await logRouteError({ startedAt, code: ErrorCode.AUTH_INVALID_KEY });
    return apiErrorLocalized(ErrorCode.AUTH_INVALID_KEY, req);
  }

  // 2. 解析请求体
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await logRouteError({ startedAt, ctx: verified.ctx, code: ErrorCode.REQUEST_INVALID_JSON });
    return apiErrorLocalized(ErrorCode.REQUEST_INVALID_JSON, req);
  }

  const model = body.model as string | undefined;
  const messages = body.messages as IRRequest["messages"] | undefined;
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    await logRouteError({
      startedAt,
      ctx: verified.ctx,
      code: ErrorCode.REQUEST_MISSING_FIELD,
      model: model || "(unknown)",
    });
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["model", "messages"] });
  }

  const stream = body.stream === true;
  // OpenAI 标准 reasoning_effort → 内部统一级别;无法映射则不设(等价 off)。
  const reasoningEffort = resolveReasoningLevel(body.reasoning_effort);
  const irRequest: IRRequest = {
    model,
    messages,
    stream,
    temperature: body.temperature as number | undefined,
    max_tokens: body.max_tokens as number | undefined,
    top_p: body.top_p as number | undefined,
    stop: body.stop as string | string[] | undefined,
    ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
  };

  // 3. 调用 streamChat 并转 OpenAI 格式
  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    return streamResponse(completionId, created, verified.ctx, irRequest, model);
  }
  return nonStreamResponse(completionId, created, verified.ctx, irRequest, model);
}

/** 流式响应:StreamEvent → OpenAI SSE 帧。 */
function streamResponse(
  id: string,
  created: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  request: IRRequest,
  model: string,
) {
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const frame = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const userAgent = await getGatewayUA();
        if (abortController.signal.aborted) return;
        for await (const ev of streamChat({
          ctx,
          request,
          cacheKey: ctx.apiKeyId ?? undefined,
          abortSignal: abortController.signal,
          userAgent,
        })) {
          if (abortController.signal.aborted) break;
          switch (ev.type) {
            case "text-delta":
              frame({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null }],
              });
              break;
            case "finish":
              frame({
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: {}, finish_reason: ev.finishReason }],
              });
              if (ev.usage) {
                frame({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  usage: {
                    prompt_tokens: ev.usage.inputTokens ?? 0,
                    completion_tokens: ev.usage.outputTokens ?? 0,
                    total_tokens: ev.usage.totalTokens ?? 0,
                  },
                });
              }
              break;
            case "error":
              frame({
                error: { message: ev.error, type: "server_error", code: ev.code },
              });
              break;
            default:
              break; // tool-call / usage 中间事件暂不转发
          }
        }
        if (!abortController.signal.aborted) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: {
                  message: err instanceof Error ? err.message : "内部错误",
                  type: "server_error",
                },
              })}\n\n`,
            ),
          );
        }
      } finally {
        if (!abortController.signal.aborted) {
          controller.close();
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 关闭 nginx/CDN 缓冲,保证流式实时性。
      "X-Accel-Buffering": "no",
    },
  });
}

/** 非流式响应:聚合全文 + 单 JSON。 */
async function nonStreamResponse(
  id: string,
  created: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  request: IRRequest,
  model: string,
) {
  let content = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let finishReason = "stop";
  let error: { message: string; code?: string } | null = null;

  for await (const ev of streamChat({ ctx, request, userAgent: await getGatewayUA() })) {
    switch (ev.type) {
      case "text-delta":
        content += ev.text;
        break;
      case "finish":
        finishReason = ev.finishReason;
        if (ev.usage) {
          usage = {
            prompt_tokens: ev.usage.inputTokens ?? 0,
            completion_tokens: ev.usage.outputTokens ?? 0,
            total_tokens: ev.usage.totalTokens ?? 0,
          };
        }
        break;
      case "error":
        error = { message: ev.error, code: ev.code };
        break;
      default:
        break;
    }
  }

  if (error) {
    return NextResponse.json(
      { error: { message: error.message, type: "server_error", code: error.code } },
      { status: 502 },
    );
  }

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage,
  });
}

/**
 * 记录一条 route 层(调 streamChat 前)的失败请求到 ops_error_logs。
 * 这些错误发生在 streamChat 之外(鉴权 / 请求体校验),stream.ts 不会记录,route 必须自己写。
 * ctx 缺失(鉴权失败)时构造空身份,userId 由 logUsage 收敛为 null。
 */
async function logRouteError(opts: {
  startedAt: number;
  ctx?: CallContext;
  model?: string;
  code: string;
  errorMessage?: string;
}): Promise<void> {
  const ctx: CallContext = opts.ctx ?? {
    userId: "",
    apiKeyId: null,
    keyKind: null,
    source: "gateway",
  };
  const httpStatus = ERROR_META[opts.code as keyof typeof ERROR_META]?.status;
  try {
    await logUsage({
      ctx,
      runId: `err_${crypto.randomUUID()}`,
      model: opts.model ?? "(unknown)",
      usage: {},
      latencyMs: Date.now() - opts.startedAt,
      status: "failed",
      errorCode: opts.code,
      errorMessage: opts.errorMessage,
      httpStatus,
      requestPath: REQUEST_PATH,
      errorPhase: classifyError({ errorCode: opts.code, httpStatus }).phase,
      errorType: opts.code,
    });
  } catch {
    /* 日志失败不阻断主流程 */
  }
}
