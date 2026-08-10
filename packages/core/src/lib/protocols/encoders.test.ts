import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, gatewayGovernanceErrorHeaders } from "@/lib/errors";
import type { CallContext, IRRequest, StreamEvent } from "@/lib/providers/types";
import {
  nonStreamProtocolResponse,
  protocolErrorResponse,
  streamProtocolResponse,
} from "./encoders";
import type { GatewayProtocol } from "./types";

const streamChat = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stream", () => ({ streamChat }));
vi.mock("@/lib/system-settings/ua", () => ({ getGatewayUA: async () => "test-gateway" }));

const ctx: CallContext = {
  userId: "user-1",
  apiKeyId: "key-1",
  keyKind: "master",
  source: "gateway",
};
const request: IRRequest = {
  model: "model-a",
  messages: [{ role: "user", content: "hello" }],
};
const usage = {
  inputTokens: 3,
  outputTokens: 5,
  totalTokens: 8,
  reasoningTokens: 2,
  cachedInputTokens: 1,
};

function mockEvents(events: StreamEvent[]) {
  streamChat.mockImplementation(() => (async function* () {
    for (const event of events) yield event;
  })());
}

function completeEvents(): StreamEvent[] {
  return [
    { type: "reasoning-delta", text: "think" },
    { type: "text-delta", text: "answer" },
    { type: "tool-call-start", toolCallId: "call-1", toolName: "weather" },
    { type: "tool-call-delta", toolCallId: "call-1", delta: "{\"city\":\"SH\"}" },
    { type: "tool-call-end", toolCallId: "call-1" },
    { type: "tool-call", toolCallId: "call-1", toolName: "weather", args: { city: "SH" } },
    { type: "usage", usage },
    { type: "finish", finishReason: "tool-calls", usage: {} },
  ];
}

interface SseFrame {
  event?: string;
  data: unknown;
}

function parseSse(text: string): SseFrame[] {
  return text.trim().split("\n\n").filter(Boolean).map((frame) => {
    const lines = frame.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    const raw = lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "";
    return { event, data: raw === "[DONE]" ? raw : JSON.parse(raw) };
  });
}

describe("protocol encoders", () => {
  beforeEach(() => streamChat.mockReset());

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s 非流式聚合文本、推理、工具和 usage", async (protocol) => {
    mockEvents(completeEvents());
    const response = await nonStreamProtocolResponse(
      protocol,
      ctx,
      request,
      new AbortController().signal,
      "/v1/test",
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;

    if (protocol === "openai-chat") {
      expect(body.choices[0]).toMatchObject({
        message: {
          content: "answer",
          reasoning_content: "think",
          tool_calls: [{ function: { name: "weather", arguments: "{\"city\":\"SH\"}" } }],
        },
        finish_reason: "tool_calls",
      });
      expect(body.usage).toMatchObject({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 });
    } else if (protocol === "openai-responses") {
      expect(body.status).toBe("completed");
      expect(body.output).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "message" }),
        expect.objectContaining({ type: "function_call", name: "weather", arguments: "{\"city\":\"SH\"}" }),
      ]));
      expect(body.usage).toMatchObject({ input_tokens: 3, output_tokens: 5, total_tokens: 8 });
    } else if (protocol === "anthropic") {
      expect(body.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "thinking", thinking: "think" }),
        expect.objectContaining({ type: "text", text: "answer" }),
        expect.objectContaining({ type: "tool_use", name: "weather", input: { city: "SH" } }),
      ]));
      expect(body.stop_reason).toBe("tool_use");
      expect(body.usage).toMatchObject({ input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 1 });
    } else {
      expect(body.candidates[0]).toMatchObject({ finishReason: "STOP" });
      expect(body.candidates[0].content.parts).toEqual(expect.arrayContaining([
        { text: "think", thought: true },
        { text: "answer" },
        { functionCall: { id: "call-1", name: "weather", args: { city: "SH" } } },
      ]));
      expect(body.usageMetadata).toMatchObject({ promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 });
    }
  });

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s 使用原生 400 错误 envelope", async (protocol) => {
    const response = protocolErrorResponse(
      protocol,
      ErrorCode.REQUEST_UNSUPPORTED_PARAMETER,
      "Unsupported parameter: 'input[0].type'.",
      { parameter: "input[0].type" },
    );
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, any>;
    expect(JSON.stringify(body)).toContain("Unsupported parameter: 'input[0].type'.");
    if (protocol.startsWith("openai")) {
      expect(body.error).toMatchObject({
        code: ErrorCode.REQUEST_UNSUPPORTED_PARAMETER,
        type: "invalid_request_error",
        param: "input[0].type",
      });
    } else if (protocol === "anthropic") {
      expect(body).toMatchObject({ type: "error", error: { type: "invalid_request_error" } });
    } else {
      expect(body.error).toMatchObject({ code: 400, status: "INVALID_ARGUMENT" });
    }
  });

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s 保留治理 429 的原生 envelope 和统一响应头", async (protocol) => {
    for (const code of [
      ErrorCode.GATEWAY_RATE_LIMIT_EXCEEDED,
      ErrorCode.GATEWAY_CONCURRENCY_LIMIT_EXCEEDED,
      ErrorCode.GATEWAY_QUOTA_EXCEEDED,
    ] as const) {
      const response = protocolErrorResponse(
        protocol,
        code,
        undefined,
        { scope: "key", resource: "requests" },
        gatewayGovernanceErrorHeaders(code, 2.01),
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("3");
      expect(response.headers.get("X-Gateway-Error-Code")).toBe(code);
      const body = await response.json() as Record<string, any>;
      if (protocol.startsWith("openai")) {
        expect(body.error).toMatchObject({ code, type: "rate_limit_exceeded" });
      } else if (protocol === "anthropic") {
        expect(body).toMatchObject({ type: "error", error: { type: "rate_limit_error" } });
      } else {
        expect(body.error).toMatchObject({ code: 429, status: "RESOURCE_EXHAUSTED" });
      }
    }
  });

  it("Chat SSE 保留 reasoning、tool_calls、usage 和 [DONE]", async () => {
    mockEvents(completeEvents());
    const frames = parseSse(await (await streamProtocolResponse(
      "openai-chat", ctx, request, new AbortController().signal, "/v1/chat/completions",
    )).text());
    const json = frames.filter((frame) => frame.data !== "[DONE]").map((frame) => frame.data) as Record<string, any>[];
    expect(json.some((chunk) => chunk.choices?.[0]?.delta?.reasoning_content === "think")).toBe(true);
    expect(json.some((chunk) => chunk.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments === "{\"city\":\"SH\"}")).toBe(true);
    expect(json.at(-1)).toMatchObject({ choices: [{ finish_reason: "tool_calls" }], usage: { total_tokens: 8 } });
    expect(frames.at(-1)?.data).toBe("[DONE]");
  });

  it("Responses SSE 使用递增序号和完整 text/function 生命周期", async () => {
    mockEvents(completeEvents());
    const frames = parseSse(await (await streamProtocolResponse(
      "openai-responses", ctx, request, new AbortController().signal, "/v1/responses",
    )).text());
    const events = frames.map((frame) => frame.event);
    expect(events).toEqual(expect.arrayContaining([
      "response.created",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ]));
    const sequenceNumbers = frames.map((frame) => (frame.data as { sequence_number?: number }).sequence_number);
    expect(sequenceNumbers).toEqual(sequenceNumbers.map((_, index) => index));
    expect((frames.at(-1)?.data as Record<string, any>).response).toMatchObject({
      status: "completed",
      usage: { total_tokens: 8 },
    });
  });

  it("Anthropic SSE 为 thinking、text、tool 分配独立 block 生命周期", async () => {
    mockEvents(completeEvents());
    const frames = parseSse(await (await streamProtocolResponse(
      "anthropic", ctx, request, new AbortController().signal, "/v1/messages",
    )).text());
    const starts = frames.filter((frame) => frame.event === "content_block_start").map((frame) => frame.data as Record<string, any>);
    const stops = frames.filter((frame) => frame.event === "content_block_stop").map((frame) => frame.data as Record<string, any>);
    expect(starts.map((frame) => frame.content_block.type)).toEqual(["thinking", "text", "tool_use"]);
    expect(new Set(starts.map((frame) => frame.index)).size).toBe(3);
    expect(stops.map((frame) => frame.index).sort()).toEqual(starts.map((frame) => frame.index).sort());
    expect(frames.at(-1)?.event).toBe("message_stop");
  });

  it("Gemini SSE 输出 thought、text、functionCall 和终态 usage", async () => {
    mockEvents(completeEvents());
    const frames = parseSse(await (await streamProtocolResponse(
      "gemini", ctx, request, new AbortController().signal, "/v1beta/models/model-a:streamGenerateContent",
    )).text());
    const parts = frames.flatMap((frame) => (frame.data as Record<string, any>).candidates?.[0]?.content?.parts ?? []);
    expect(parts).toEqual(expect.arrayContaining([
      { text: "think", thought: true },
      { text: "answer" },
      { functionCall: { id: "call-1", name: "weather", args: { city: "SH" } } },
    ]));
    expect(frames.at(-1)?.data).toMatchObject({
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { totalTokenCount: 8 },
    });
  });

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s SSE 使用原生错误事件且不输出成功终态", async (protocol) => {
    mockEvents([{ type: "error", error: "upstream failed", code: "gateway.upstream_error" }]);
    const frames = parseSse(await (await streamProtocolResponse(
      protocol, ctx, request, new AbortController().signal, "/v1/test",
    )).text());
    expect(JSON.stringify(frames)).toContain("upstream failed");
    expect(JSON.stringify(frames)).not.toContain("[DONE]");
    expect(JSON.stringify(frames)).not.toContain("response.completed");
    expect(JSON.stringify(frames)).not.toContain("message_stop");
  });

  it.each([
    ["openai-chat", "/v1/chat/completions"],
    ["openai-responses", "/v1/responses"],
    ["anthropic", "/v1/messages"],
    ["gemini", "/v1beta/models/model-a:streamGenerateContent"],
  ] as const)("%s 把客户端取消传给 streamChat", async (protocol, requestPath) => {
    let release: (() => void) | undefined;
    streamChat.mockReturnValue((async function* () {
      await new Promise<void>((resolve) => { release = resolve; });
    })());
    const source = new AbortController();
    const response = streamProtocolResponse(protocol, ctx, request, source.signal, requestPath);

    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledOnce());
    const upstreamSignal = streamChat.mock.calls[0]?.[0]?.abortSignal as AbortSignal | undefined;
    expect(upstreamSignal).toBeDefined();
    source.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    release?.();
    await response.body!.cancel();
  });

  it.each<GatewayProtocol>([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini",
  ])("%s 未知 finish reason 转错误终态", async (protocol) => {
    mockEvents([{ type: "finish", finishReason: "unknown-provider-reason", usage }]);
    const response = await nonStreamProtocolResponse(
      protocol, ctx, request, new AbortController().signal, "/v1/test",
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).toContain("Unknown finish reason");
  });
});
