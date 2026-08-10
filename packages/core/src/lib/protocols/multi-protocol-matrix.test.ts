import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteApiFormat } from "@/db/types";
import type { CallContext, ResolvedRoute } from "@/lib/providers/types";
import { handleProtocolRequest } from "./handler";
import {
  parseAnthropicMessages,
  parseChatCompletions,
  parseGeminiGenerateContent,
  parseResponses,
} from "./parsers";
import type { GatewayProtocol, ParsedGatewayRequest } from "./types";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveRoutes: vi.fn(),
  startExecution: vi.fn(),
  recordAttempt: vi.fn(),
  finalizeExecution: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("@/lib/routing", () => ({
  resolveRoutes: mocks.resolveRoutes,
  resolveRoutesById: vi.fn(),
}));
vi.mock("@/lib/circuit-breaker", () => ({
  recordSuccess: mocks.recordSuccess,
  recordFailure: mocks.recordFailure,
}));
vi.mock("@/lib/gateway-execution", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/gateway-execution")>(),
  gatewayTelemetry: {
    startExecution: mocks.startExecution,
    recordAttempt: mocks.recordAttempt,
    finalizeExecution: mocks.finalizeExecution,
  },
}));
vi.mock("@/lib/infra/metrics", () => ({
  acquireStream: vi.fn(),
  releaseStream: vi.fn(),
}));
vi.mock("@/lib/repositories/route-repository", () => ({
  markProviderStreamUsageUnsupported: vi.fn(),
  markRouteToolsUnsupported: vi.fn(),
}));
vi.mock("@/lib/system-settings/ua", () => ({
  getChatUA: async () => "matrix-test",
  getGatewayUA: async () => "matrix-test",
}));

const CLIENT_MODEL = "client-model";
const UPSTREAM_MODEL = "upstream-model";
const INPUT_TEXT = "matrix hello";
const OUTPUT_TEXT = "matrix reply";
const UPSTREAM_KEY = "matrix-upstream-key";

const ctx: CallContext = {
  userId: "user-matrix",
  apiKeyId: "key-matrix",
  keyKind: "master",
  source: "gateway",
};

interface IngressCase {
  name: string;
  protocol: GatewayProtocol;
  path: string;
  body: Record<string, unknown>;
  parse: (body: unknown) => ParsedGatewayRequest;
}

const ingressCases: IngressCase[] = [
  {
    name: "OpenAI Chat",
    protocol: "openai-chat",
    path: "/v1/chat/completions",
    body: {
      model: CLIENT_MODEL,
      messages: [{ role: "user", content: INPUT_TEXT }],
    },
    parse: parseChatCompletions,
  },
  {
    name: "OpenAI Responses",
    protocol: "openai-responses",
    path: "/v1/responses",
    body: { model: CLIENT_MODEL, input: INPUT_TEXT, store: false },
    parse: parseResponses,
  },
  {
    name: "Anthropic Messages",
    protocol: "anthropic",
    path: "/v1/messages",
    body: {
      model: CLIENT_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: INPUT_TEXT }],
    },
    parse: parseAnthropicMessages,
  },
  {
    name: "Gemini GenerateContent",
    protocol: "gemini",
    path: `/v1beta/models/${CLIENT_MODEL}:generateContent`,
    body: { contents: [{ role: "user", parts: [{ text: INPUT_TEXT }] }] },
    parse: (body) => parseGeminiGenerateContent(body, CLIENT_MODEL, false),
  },
];

const egressCases: Array<{ name: string; apiFormat: RouteApiFormat }> = [
  { name: "OpenAI Chat", apiFormat: "openai-chat" },
  { name: "OpenAI Responses", apiFormat: "openai-responses" },
  { name: "Anthropic Messages", apiFormat: "anthropic-messages" },
  { name: "Gemini GenerateContent", apiFormat: "gemini-generate-content" },
];

function routeFor(apiFormat: RouteApiFormat): ResolvedRoute {
  return {
    modelName: CLIENT_MODEL,
    upstreamModelName: UPSTREAM_MODEL,
    apiFormat,
    protocol: "openai-compatible",
    provider: {
      id: "provider-matrix",
      name: "Matrix Provider",
      protocol: "openai-compatible",
      baseUrl: apiFormat === "gemini-generate-content"
        ? "https://upstream.test/v1beta/"
        : "https://upstream.test/v1/",
      apiKey: UPSTREAM_KEY,
      keys: [{ key: UPSTREAM_KEY, weight: 1 }],
      headers: {
        authorization: "Bearer provider-override",
        "x-api-key": "provider-override",
        "x-goog-api-key": "provider-override",
        "x-provider-header": "provider-value",
        "x-shared-header": "provider-value",
      },
    },
    headers: {
      Authorization: "Bearer route-override",
      "X-Api-Key": "route-override",
      "X-Goog-Api-Key": "route-override",
      "x-route-header": "route-value",
      "x-shared-header": "route-value",
    },
    priority: 0,
    weight: 1,
    source: "byo",
    routeId: "route-matrix",
    supportsTools: true,
    capabilities: { tools: true },
  };
}

function eventStream(events: unknown[], done = false): Response {
  const frames = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(`${frames}${done ? "data: [DONE]\n\n" : ""}`, {
    headers: { "content-type": "text/event-stream" },
  });
}

function upstreamResponse(apiFormat: RouteApiFormat): Response {
  switch (apiFormat) {
    case "openai-chat":
      return eventStream([
        {
          id: "chatcmpl-matrix",
          created: 1,
          model: UPSTREAM_MODEL,
          choices: [{ index: 0, delta: { role: "assistant", content: OUTPUT_TEXT }, finish_reason: null }],
        },
        {
          id: "chatcmpl-matrix",
          created: 1,
          model: UPSTREAM_MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        },
      ], true);
    case "openai-responses":
      return eventStream([
        {
          type: "response.created",
          response: { id: "resp_matrix", created_at: 1, model: UPSTREAM_MODEL },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: "msg_matrix", phase: "final_answer" },
        },
        { type: "response.output_text.delta", item_id: "msg_matrix", delta: OUTPUT_TEXT },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "message", id: "msg_matrix", phase: "final_answer" },
        },
        {
          type: "response.completed",
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 2,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 2,
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ], true);
    case "anthropic-messages":
      return eventStream([
        {
          type: "message_start",
          message: {
            id: "msg_matrix",
            model: UPSTREAM_MODEL,
            role: "assistant",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: OUTPUT_TEXT } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ]);
    case "gemini-generate-content":
      return eventStream([{
        candidates: [{
          content: { parts: [{ text: OUTPUT_TEXT }] },
          finishReason: "STOP",
        }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
      }]);
    default:
      throw new Error(`Unsupported matrix format: ${apiFormat}`);
  }
}

function expectEndpoint(apiFormat: RouteApiFormat, url: URL): void {
  if (apiFormat === "gemini-generate-content") {
    expect(url.pathname).toBe(`/v1beta/models/${UPSTREAM_MODEL}:streamGenerateContent`);
    expect(url.searchParams.get("alt")).toBe("sse");
    return;
  }
  expect(url.search).toBe("");
  expect(url.pathname).toBe({
    "openai-chat": "/v1/chat/completions",
    "openai-responses": "/v1/responses",
    "anthropic-messages": "/v1/messages",
  }[apiFormat]);
}

function expectAuthentication(apiFormat: RouteApiFormat, headers: Headers): void {
  const expected = apiFormat === "anthropic-messages"
    ? "x-api-key"
    : apiFormat === "gemini-generate-content"
      ? "x-goog-api-key"
      : "authorization";
  for (const name of ["authorization", "x-api-key", "x-goog-api-key"]) {
    expect(headers.get(name), name).toBe(name === expected
      ? expected === "authorization" ? `Bearer ${UPSTREAM_KEY}` : UPSTREAM_KEY
      : null);
  }
  expect(headers.get("x-provider-header")).toBe("provider-value");
  expect(headers.get("x-route-header")).toBe("route-value");
  expect(headers.get("x-shared-header")).toBe("route-value");
}

function expectUpstreamBody(
  apiFormat: RouteApiFormat,
  body: Record<string, unknown>,
): void {
  switch (apiFormat) {
    case "openai-chat":
      expect(body).toMatchObject({
        model: UPSTREAM_MODEL,
        messages: expect.any(Array),
        stream: true,
        stream_options: { include_usage: true },
      });
      break;
    case "openai-responses":
      expect(body).toMatchObject({
        model: UPSTREAM_MODEL,
        input: expect.any(Array),
        store: false,
        stream: true,
      });
      break;
    case "anthropic-messages":
      expect(body).toMatchObject({
        model: UPSTREAM_MODEL,
        messages: expect.any(Array),
        max_tokens: expect.any(Number),
        stream: true,
      });
      break;
    case "gemini-generate-content":
      expect(body).toMatchObject({ contents: expect.any(Array) });
      expect(body).not.toHaveProperty("model");
      break;
  }
  expect(JSON.stringify(body)).toContain(INPUT_TEXT);
}

function expectIngressResponse(protocol: GatewayProtocol, body: Record<string, any>): void {
  if (protocol === "openai-chat") {
    expect(body).toMatchObject({
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: OUTPUT_TEXT } }],
    });
  } else if (protocol === "openai-responses") {
    expect(body).toMatchObject({ object: "response", status: "completed" });
    expect(body.output).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "message",
        content: expect.arrayContaining([expect.objectContaining({ type: "output_text", text: OUTPUT_TEXT })]),
      }),
    ]));
  } else if (protocol === "anthropic") {
    expect(body).toMatchObject({
      type: "message",
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: OUTPUT_TEXT })]),
    });
  } else {
    expect(body.candidates?.[0]?.content?.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: OUTPUT_TEXT })]),
    );
  }
}

describe("multi-protocol gateway matrix", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset().mockResolvedValue(ctx);
    mocks.resolveRoutes.mockReset();
    mocks.startExecution.mockReset().mockResolvedValue(undefined);
    mocks.recordAttempt.mockReset().mockResolvedValue(undefined);
    mocks.finalizeExecution.mockReset().mockResolvedValue(undefined);
    mocks.recordSuccess.mockReset();
    mocks.recordFailure.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(ingressCases.flatMap((ingress) => egressCases.map((egress) => ({ ingress, egress }))))(
    "$ingress.name ingress -> $egress.name upstream",
    async ({ ingress, egress }) => {
      const captured: Array<{ url: URL; headers: Headers; body: Record<string, unknown> }> = [];
      mocks.resolveRoutes.mockResolvedValueOnce([routeFor(egress.apiFormat)]);
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        captured.push({
          url: new URL(request.url),
          headers: request.headers,
          body: JSON.parse(await request.text()) as Record<string, unknown>,
        });
        return upstreamResponse(egress.apiFormat);
      }));

      const response = await handleProtocolRequest(
        new Request(`https://gateway.test${ingress.path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ingress.body),
        }),
        ingress.protocol,
        ingress.path,
        ingress.parse,
      );

      const responseBody = await response.json() as Record<string, any>;
      expect(response.status, JSON.stringify(responseBody)).toBe(200);
      expect(captured).toHaveLength(1);
      expectEndpoint(egress.apiFormat, captured[0].url);
      expectAuthentication(egress.apiFormat, captured[0].headers);
      expectUpstreamBody(egress.apiFormat, captured[0].body);
      expectIngressResponse(ingress.protocol, responseBody);
      expect(mocks.recordSuccess).toHaveBeenCalledOnce();
      expect(mocks.recordFailure).not.toHaveBeenCalled();
      expect(mocks.finalizeExecution).toHaveBeenCalledOnce();
    },
  );

  it("已学习不支持流式 usage 的 Provider 不发送 stream_options", async () => {
    const ingress = ingressCases[0];
    const route = routeFor("openai-chat");
    route.provider.supportsStreamUsage = false;
    let upstreamBody: Record<string, unknown> | undefined;
    mocks.resolveRoutes.mockResolvedValueOnce([route]);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      upstreamBody = JSON.parse(await request.text()) as Record<string, unknown>;
      return upstreamResponse("openai-chat");
    }));

    const response = await handleProtocolRequest(
      new Request(`https://gateway.test${ingress.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ingress.body),
      }),
      ingress.protocol,
      ingress.path,
      ingress.parse,
    );

    expect(response.status).toBe(200);
    expect(upstreamBody).not.toHaveProperty("stream_options");
  });
});
