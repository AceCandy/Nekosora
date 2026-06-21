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
import { verifyKey, extractBearer } from "@/lib/keys";
import { apiErrorLocalized, ErrorCode } from "@/lib/errors";
import type { IRRequest } from "@/lib/providers/types";

export const runtime = "nodejs";
// 禁用响应缓冲,保证 SSE 实时推送(Next.js 网关关键坑)。
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const rawKey = extractBearer(req.headers.get("authorization"));
  if (!rawKey) {
    return apiErrorLocalized(ErrorCode.AUTH_MISSING_KEY, req);
  }
  const verified = await verifyKey(rawKey);
  if (!verified) {
    return apiErrorLocalized(ErrorCode.AUTH_INVALID_KEY, req);
  }

  // 2. 解析请求体
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiErrorLocalized(ErrorCode.REQUEST_INVALID_JSON, req);
  }

  const model = body.model as string | undefined;
  const messages = body.messages as IRRequest["messages"] | undefined;
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return apiErrorLocalized(ErrorCode.REQUEST_MISSING_FIELD, req, { fields: ["model", "messages"] });
  }

  const stream = body.stream === true;
  const irRequest: IRRequest = {
    model,
    messages,
    stream,
    temperature: body.temperature as number | undefined,
    max_tokens: body.max_tokens as number | undefined,
    top_p: body.top_p as number | undefined,
    stop: body.stop as string | string[] | undefined,
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
        for await (const ev of streamChat({ ctx, request })) {
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
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
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
      } finally {
        controller.close();
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

  for await (const ev of streamChat({ ctx, request })) {
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
