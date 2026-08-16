import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => ({ jsonSchema: schema })),
  Output: { json: vi.fn(() => ({ kind: "json-output" })) },
}));

const callMcpTool = vi.fn();
const { markRouteToolsUnsupportedMock } = vi.hoisted(() => ({
  markRouteToolsUnsupportedMock: vi.fn(async () => undefined),
}));
const toIRTools = vi.fn(
  (servers: Array<{ name: string; tools: Array<{ name: string; description?: string }> }>) =>
    servers.flatMap((server) =>
      server.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: `${server.name}__${t.name}`,
          description: t.description ?? t.name,
          parameters: { type: "object", properties: {} },
        },
      })),
    ),
);
vi.mock("@/lib/mcp/registry", () => ({
  toIRTools: (...args: unknown[]) => toIRTools(...args as Parameters<typeof toIRTools>),
  callMcpTool: (...args: unknown[]) => callMcpTool(...args),
}));
vi.mock("@/lib/repositories/route-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repositories/route-repository")>();
  return { ...actual, markRouteToolsUnsupported: markRouteToolsUnsupportedMock };
});

const logUsage = vi.fn(async () => undefined);
const telemetry = vi.hoisted(() => ({
  startExecution: vi.fn(async () => undefined),
  recordAttempt: vi.fn(async () => undefined),
  finalizeExecution: vi.fn(async () => undefined),
}));
vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>("@/lib/usage");
  return {
    ...actual,
    logUsage: (...args: unknown[]) => logUsage(...args),
  };
});
vi.mock("@/lib/gateway-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gateway-execution")>();
  return { ...actual, gatewayTelemetry: telemetry };
});

import { generateText, streamText } from "ai";
import { streamChatWithTools } from "@/lib/stream";
import {
  resetRouteRepository,
  setRouteRepository,
  markRouteToolsUnsupported,
  type RouteRepository,
} from "@/lib/repositories/route-repository";
import { encrypt } from "@/lib/infra/crypto";
import { resetAllBreakers } from "@/lib/circuit-breaker";
import type { StreamEvent } from "@/lib/providers/types";

let encryptedKeys = "";

function makeSingleRouteRepository(): RouteRepository {
  return {
    findEnabledModelById: async (id) => id === "model-a" ? ({
      id: "model-a",
      name: "test-model",
      ownerUserId: "user-a",
      visibility: "public",
      enabled: true,
      capabilities: { tools: true },
    }) : null,
    findEnabledModelByNameForOwner: async () => ({
      id: "model-a",
      name: "test-model",
      ownerUserId: "user-a",
      visibility: "private",
      enabled: true,
      capabilities: { tools: true },
    }),
    findEnabledRoutes: async () => [{
      route: {
        id: "route-a",
        modelId: "model-a",
        providerId: "provider-a",
        upstreamModelName: "upstream-model",
        priority: 0,
        weight: 1,
        supportsTools: true,
        enabled: true,
      },
      provider: {
        id: "provider-a",
        name: "Provider A",
        protocol: "openai",
        baseUrl: "https://example.com/v1",
        apiKeysEnc: encryptedKeys,
        enabled: true,
      },
    }],
    findEnabledProvider: async () => null,
    findKeyModelBindings: async () => ({ modelIds: new Set() }),
  };
}

function mockStreamResult(parts: unknown[], finishReason: string, usage = {
  inputTokens: 3,
  outputTokens: 5,
  totalTokens: 8,
}) {
  return {
    stream: (async function* () {
      for (const part of parts) yield part;
    })(),
    usage: Promise.resolve(usage),
    finishReason: Promise.resolve(finishReason),
  } as never;
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

const baseOpts = {
  ctx: { userId: "user-a", keyKind: null, source: "chat" as const },
  request: {
    model: "test-model",
    messages: [{ role: "user" as const, content: "hello" }],
    tools: [{
      type: "function" as const,
      function: {
        name: "demo__echo",
        description: "echo",
        parameters: { type: "object", properties: {} },
      },
    }],
  },
  userAgent: "Nekusora-Test",
};

function makeWebSearchTool(
  execute: (toolCallId: string, args: unknown) => Promise<{ result: unknown; isError: boolean }>,
) {
  return {
    definition: {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: vi.fn(execute),
  };
}

describe("streamChatWithTools agent loop finish signal", () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    encryptedKeys = encrypt(JSON.stringify({ keys: [{ key: "sk-test-fake", weight: 1 }] }));
  });

  beforeEach(() => {
    resetAllBreakers();
    setRouteRepository(makeSingleRouteRepository());
    vi.mocked(generateText).mockReset();
    vi.mocked(streamText).mockReset();
    callMcpTool.mockReset();
    vi.mocked(markRouteToolsUnsupported).mockReset();
    toIRTools.mockClear();
    logUsage.mockClear();
    telemetry.startExecution.mockClear();
    telemetry.recordAttempt.mockClear();
    telemetry.finalizeExecution.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetRouteRepository();
    resetAllBreakers();
    vi.restoreAllMocks();
  });

  it("无工具调用时仍向外层发唯一最终 finish", async () => {
    vi.mocked(streamText).mockReturnValue(mockStreamResult(
      [{ type: "text-delta", text: "hi" }],
      "stop",
      { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    ));

    const events = await collect(streamChatWithTools(baseOpts));
    const finishes = events.filter((e) => e.type === "finish");

    expect(events.map((e) => e.type)).toEqual(["text-delta", "finish"]);
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });
  });

  it("将 IR 工具数组转换为 AI SDK ToolSet", async () => {
    vi.mocked(streamText).mockReturnValue(mockStreamResult([], "stop"));

    await collect(streamChatWithTools({
      ...baseOpts,
      request: {
        ...baseOpts.request,
        tools: [{
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        }],
      },
    }));

    const request = vi.mocked(streamText).mock.calls[0]?.[0] as {
      tools?: Record<string, {
        description?: string;
        inputSchema?: { jsonSchema?: unknown };
        execute?: unknown;
      }>;
    };
    expect(Array.isArray(request.tools)).toBe(false);
    expect(Object.keys(request.tools ?? {})).toEqual(["web_search"]);
    expect(request.tools).not.toHaveProperty("0");
    expect(request.tools?.web_search).toMatchObject({
      description: "Search the web",
      inputSchema: {
        jsonSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    });
    expect(request.tools?.web_search).not.toHaveProperty("execute");
  });

  it("带工具的请求跳过未验证工具能力的路由", async () => {
    const repository = makeSingleRouteRepository();
    const originalFindEnabledRoutes = repository.findEnabledRoutes;
    repository.findEnabledRoutes = async (modelId) => {
      const [supported] = await originalFindEnabledRoutes(modelId);
      return [
        {
          ...supported,
          route: {
            ...supported.route,
            id: "route-unsupported",
            priority: -1,
            supportsTools: false,
          },
        },
        supported,
      ];
    };
    setRouteRepository(repository);
    vi.mocked(streamText).mockReturnValue(mockStreamResult(
      [{ type: "text-delta", text: "supported" }],
      "stop",
    ));

    const events = await collect(streamChatWithTools(baseOpts));

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["text-delta", "finish"]);
    expect(telemetry.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      route: expect.objectContaining({ routeId: "route-unsupported" }),
      status: "rejected",
    }));
  });

  it("工具链:中间 finish 不外发,最终文本轮发一次 finish 且 usage 跨轮聚合", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [
          { type: "text-delta", text: "calling " },
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "demo__echo",
            input: { q: "1" },
          },
        ],
        "tool-calls",
        { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      ))
      .mockReturnValueOnce(mockStreamResult(
        [{ type: "text-delta", text: "done" }],
        "stop",
        { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
      ));

    callMcpTool.mockResolvedValue({ result: "echo-ok", isError: false });

    const events = await collect(streamChatWithTools(baseOpts));
    const finishes = events.filter((e) => e.type === "finish");

    expect(events.map((e) => e.type)).toEqual([
      "text-delta",
      "text-retract",
      "tool-call",
      "tool-result",
      "text-delta",
      "finish",
    ]);
    expect(finishes).toHaveLength(1);
    expect(events.find((e) => e.type === "text-retract")).toEqual({
      type: "text-retract",
      text: "calling ",
    });
    expect(finishes[0]).toMatchObject({
      finishReason: "stop",
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
    });
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({
      type: "tool-result",
      toolCallId: "tc1",
      toolName: "demo__echo",
      result: "echo-ok",
      isError: false,
    });
    expect(callMcpTool).toHaveBeenCalledWith(
      [],
      "tc1",
      "demo__echo",
      { q: "1" },
    );
  });

  it("工具调用出现后不再透传该轮后续正文", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [
          { type: "text-delta", text: "search plan" },
          { type: "tool-call", toolCallId: "tc1", toolName: "demo__echo", input: {} },
          { type: "text-delta", text: "hidden tail" },
        ],
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult([{ type: "text-delta", text: "final answer" }], "stop"));
    callMcpTool.mockResolvedValue({ result: "ok", isError: false });

    const events = await collect(streamChatWithTools(baseOpts));

    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "search plan" },
      { type: "text-delta", text: "final answer" },
    ]);
    expect(events).toContainEqual({ type: "text-retract", text: "search plan" });
  });

  it("同轮多个工具调用聚合为一条 assistant 消息后再追加全部结果", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "demo__echo",
            input: { q: "1" },
          },
          {
            type: "tool-call",
            toolCallId: "tc2",
            toolName: "demo__echo",
            input: { q: "2" },
          },
        ],
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult(
        [{ type: "text-delta", text: "done" }],
        "stop",
      ));
    callMcpTool
      .mockResolvedValueOnce({ result: "first", isError: false })
      .mockResolvedValueOnce({ result: { value: "second" }, isError: false });

    await collect(streamChatWithTools(baseOpts));

    const secondRequest = vi.mocked(streamText).mock.calls[1]?.[0] as {
      messages?: unknown[];
    };
    expect(secondRequest.messages).toEqual([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "demo__echo",
            input: { q: "1" },
          },
          {
            type: "tool-call",
            toolCallId: "tc2",
            toolName: "demo__echo",
            input: { q: "2" },
          },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "demo__echo",
          output: { type: "text", value: "first" },
        }],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc2",
          toolName: "demo__echo",
          output: { type: "text", value: JSON.stringify({ value: "second" }) },
        }],
      },
    ]);
  });

  it("同轮多个 web_search 限流并行并按调用顺序回填结果", async () => {
    let active = 0;
    let maxActive = 0;
    const webSearchTool = makeWebSearchTool(async (toolCallId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await Promise.resolve();
      active -= 1;
      if (toolCallId === "search-1") throw new Error("search failed");
      return { result: `result-${toolCallId}`, isError: false };
    });
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        Array.from({ length: 4 }, (_, index) => ({
          type: "tool-call",
          toolCallId: `search-${index + 1}`,
          toolName: "web_search",
          input: { query: `query-${index + 1}` },
        })),
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult([{ type: "text-delta", text: "done" }], "stop"));

    const events = await collect(streamChatWithTools({
      ...baseOpts,
      request: { ...baseOpts.request, tools: [] },
      webSearchTool,
    }));

    expect(maxActive).toBe(3);
    expect(events.filter((event) => event.type === "tool-result")).toEqual([
      expect.objectContaining({ toolCallId: "search-1", result: "search failed", isError: true }),
      expect.objectContaining({ toolCallId: "search-2", result: "result-search-2" }),
      expect.objectContaining({ toolCallId: "search-3", result: "result-search-3" }),
      expect.objectContaining({ toolCallId: "search-4", result: "result-search-4" }),
    ]);
  });

  it("web_search 与 MCP 混合时保持串行执行", async () => {
    let active = 0;
    let maxActive = 0;
    const execute = async (result: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { result, isError: false };
    };
    const webSearchTool = makeWebSearchTool(() => execute("search"));
    callMcpTool.mockImplementation(() => execute("mcp"));
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [
          { type: "tool-call", toolCallId: "search", toolName: "web_search", input: {} },
          { type: "tool-call", toolCallId: "mcp", toolName: "demo__echo", input: {} },
        ],
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult([{ type: "text-delta", text: "done" }], "stop"));

    await collect(streamChatWithTools({ ...baseOpts, webSearchTool }));

    expect(maxActive).toBe(1);
  });

  it("同轮并行 web_search 共享取消信号并终止生成", async () => {
    const controller = new AbortController();
    let started = 0;
    const webSearchTool = makeWebSearchTool(async () => {
      started += 1;
      await Promise.resolve();
      if (!controller.signal.aborted) controller.abort();
      controller.signal.throwIfAborted();
      return { result: "unreachable", isError: false };
    });
    vi.mocked(streamText).mockReturnValueOnce(mockStreamResult(
      [
        { type: "tool-call", toolCallId: "search-1", toolName: "web_search", input: {} },
        { type: "tool-call", toolCallId: "search-2", toolName: "web_search", input: {} },
      ],
      "tool-calls",
    ));

    await expect(collect(streamChatWithTools({
      ...baseOpts,
      request: { ...baseOpts.request, tools: [] },
      abortSignal: controller.signal,
      webSearchTool,
    }))).rejects.toThrow();

    expect(started).toBe(2);
    expect(controller.signal.aborted).toBe(true);
  });

  it("上游 error 透传且不伪造最终 finish", async () => {
    vi.mocked(streamText).mockReturnValue({
      stream: (async function* () {
        yield { type: "error", error: new Error("upstream boom") };
      })(),
    } as never);

    const events = await collect(streamChatWithTools(baseOpts));

    expect(events.some((e) => e.type === "finish")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: "upstream boom",
    });
    expect(telemetry.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "failed" }),
    }));
  });

  it("工具能力拒绝后只重试一次无工具请求且不暴露首轮错误", async () => {
    const unsupported = Object.assign(new Error("tools are not supported"), { statusCode: 400 });
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult([{ type: "error", error: unsupported }], "error"))
      .mockReturnValueOnce(mockStreamResult(
        [{ type: "text-delta", text: "fallback" }],
        "stop",
        { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      ));

    const events = await collect(streamChatWithTools(baseOpts));
    const firstRequest = vi.mocked(streamText).mock.calls[0]?.[0] as { tools?: unknown };
    const secondRequest = vi.mocked(streamText).mock.calls[1]?.[0] as { tools?: unknown };

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(firstRequest.tools).toBeDefined();
    expect(secondRequest.tools).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(["text-delta", "finish"]);
    expect(events.find((event) => event.type === "text-delta")).toMatchObject({ text: "fallback" });
    expect(markRouteToolsUnsupported).toHaveBeenCalledOnce();
    expect(telemetry.startExecution).toHaveBeenCalledTimes(1);
    expect(telemetry.finalizeExecution).toHaveBeenCalledTimes(1);
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "success" }),
    }));
  });

  it("无工具重试再次失败时不继续重试", async () => {
    const unsupported = Object.assign(new Error("tools are not supported"), { statusCode: 400 });
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult([{ type: "error", error: unsupported }], "error"))
      .mockReturnValueOnce(mockStreamResult([{ type: "error", error: unsupported }], "error"));

    const events = await collect(streamChatWithTools(baseOpts));

    expect(vi.mocked(streamText)).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ type: "error", error: "tools are not supported" });
    expect(markRouteToolsUnsupported).toHaveBeenCalledOnce();
  });

  it("工具执行失败仍继续到最终文本,并透传 tool-result isError", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [{
          type: "tool-call",
          toolCallId: "tc-err",
          toolName: "demo__echo",
          input: {},
        }],
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult(
        [{ type: "text-delta", text: "recovered" }],
        "stop",
        { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      ));

    callMcpTool.mockRejectedValue(new Error("mcp down"));

    const events = await collect(streamChatWithTools(baseOpts));
    const toolResult = events.find((e) => e.type === "tool-result");
    const finishes = events.filter((e) => e.type === "finish");

    expect(toolResult).toMatchObject({
      type: "tool-result",
      isError: true,
      result: "mcp down",
    });
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({ finishReason: "stop" });
    expect(markRouteToolsUnsupported).not.toHaveBeenCalled();
  });

  it("多轮 agent 聚合为一条 success 日志", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [{
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "demo__echo",
          input: {},
        }],
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult(
        [{ type: "text-delta", text: "ok" }],
        "stop",
      ));
    callMcpTool.mockResolvedValue({ result: "x", isError: false });

    await collect(streamChatWithTools({
      ...baseOpts,
      runId: "run_shared",
    }));

    expect(telemetry.startExecution).toHaveBeenCalledTimes(1);
    expect(telemetry.finalizeExecution).toHaveBeenCalledTimes(1);
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      initial: expect.objectContaining({ requestId: "run_shared" }),
      outcome: expect.objectContaining({
        status: "success",
        usage: expect.objectContaining({ inputTokens: 6, outputTokens: 10, totalTokens: 16 }),
        route: expect.objectContaining({ routeId: "route-a", upstreamModelName: "upstream-model" }),
      }),
      firstTokenLatencyMs: expect.any(Number),
    }));
  });

  it("maxSteps=0 时写入唯一 interrupted fallback", async () => {
    await collect(streamChatWithTools({
      ...baseOpts,
      runId: "run_zero_steps",
      taskKind: "memory",
      maxSteps: 0,
    }));

    expect(streamText).not.toHaveBeenCalled();
    expect(telemetry.startExecution).toHaveBeenCalledTimes(1);
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      initial: expect.objectContaining({ requestId: "run_zero_steps", taskKind: "memory" }),
      outcome: expect.objectContaining({ status: "interrupted" }),
    }));
  });

  it("进入首步回调前异常时写入唯一 failed fallback", async () => {
    const brokenMessages = new Proxy(baseOpts.request.messages, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error("messages unavailable");
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(collect(streamChatWithTools({
      ...baseOpts,
      runId: "run_pre_step_failure",
      request: { ...baseOpts.request, messages: brokenMessages },
    }))).rejects.toThrow("messages unavailable");

    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      initial: expect.objectContaining({ requestId: "run_pre_step_failure" }),
      outcome: expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({ message: "messages unavailable" }),
      }),
    }));
  });

  it("maxSteps 耗尽后追加一次禁用工具的最终总结", async () => {
    let modelCall = 0;
    vi.mocked(streamText).mockImplementation(() => {
      modelCall += 1;
      if (modelCall <= 2) {
        return mockStreamResult(
          [{
            type: "tool-call",
            toolCallId: `tc-loop-${modelCall}`,
            toolName: "demo__echo",
            input: { step: modelCall },
          }],
          "tool-calls",
        );
      }
      return mockStreamResult(
        [{ type: "text-delta", text: "final summary" }],
        "stop",
      );
    });
    callMcpTool.mockResolvedValue({ result: "loop", isError: false });

    const events = await collect(streamChatWithTools({
      ...baseOpts,
      maxSteps: 2,
    }));

    expect(events.filter((e) => e.type === "tool-call")).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool-result")).toHaveLength(2);
    expect(events.filter((e) => e.type === "finish")).toEqual([
      expect.objectContaining({
        type: "finish",
        finishReason: "stop",
        usage: expect.objectContaining({
          inputTokens: 9,
          outputTokens: 15,
          totalTokens: 24,
        }),
      }),
    ]);
    expect(events).toContainEqual({ type: "text-delta", text: "final summary" });
    expect(streamText).toHaveBeenCalledTimes(3);
    const finalRequest = vi.mocked(streamText).mock.calls[2]?.[0] as {
      tools?: unknown;
      messages?: Array<{ role?: string }>;
    };
    expect(finalRequest.tools).toBeUndefined();
    expect(finalRequest.messages?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
    expect(telemetry.finalizeExecution).toHaveBeenCalledTimes(1);
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({
        status: "success",
        usage: expect.objectContaining({ inputTokens: 9, outputTokens: 15, totalTokens: 24 }),
      }),
    }));
  });

  it("最终总结失败时不伪造 finish 或重复执行工具", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [{
          type: "tool-call",
          toolCallId: "tc-loop",
          toolName: "demo__echo",
          input: {},
        }],
        "tool-calls",
      ))
      .mockReturnValueOnce({
        stream: (async function* () {
          yield { type: "error", error: new Error("summary failed") };
        })(),
      } as never);
    callMcpTool.mockResolvedValue({ result: "loop", isError: false });

    const events = await collect(streamChatWithTools({
      ...baseOpts,
      maxSteps: 1,
    }));

    expect(streamText).toHaveBeenCalledTimes(2);
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "finish")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", error: "summary failed" });
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "failed" }),
    }));
  });

  it("工具后的正常轮只有 finish 没有正文时回退非流式生成且不重复执行工具", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [{
          type: "tool-call",
          toolCallId: "tc-empty-summary",
          toolName: "demo__echo",
          input: {},
        }],
        "tool-calls",
      ))
      .mockReturnValueOnce(mockStreamResult([], "stop"));
    vi.mocked(generateText).mockResolvedValue({
      text: "回退后的最终回答",
      reasoningText: undefined,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    } as never);
    callMcpTool.mockResolvedValue({ result: "搜索结果", isError: false });

    const events = await collect(streamChatWithTools({
      ...baseOpts,
      maxSteps: 2,
    }));

    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: "text-delta", text: "回退后的最终回答" });
    expect(events.filter((event) => event.type === "finish")).toHaveLength(1);
  });

  it("最终总结收到 finish 时若已取消仍按 interrupted 收敛", async () => {
    const controller = new AbortController();
    vi.mocked(streamText)
      .mockReturnValueOnce(mockStreamResult(
        [{
          type: "tool-call",
          toolCallId: "tc-loop",
          toolName: "demo__echo",
          input: {},
        }],
        "tool-calls",
      ))
      .mockReturnValueOnce({
        stream: (async function* () {})(),
        usage: Promise.resolve({ inputTokens: 3, outputTokens: 5, totalTokens: 8 }),
        finishReason: {
          then(resolve: (reason: string) => void) {
            controller.abort();
            resolve("stop");
          },
        },
      } as never);
    callMcpTool.mockResolvedValue({ result: "loop", isError: false });

    const events = await collect(streamChatWithTools({
      ...baseOpts,
      maxSteps: 1,
      abortSignal: controller.signal,
    }));

    expect(controller.signal.aborted).toBe(true);
    expect(events.some((event) => event.type === "finish")).toBe(false);
    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ status: "interrupted" }),
    }));
  });

  it("MCP 工具初始化失败时写入唯一 failed fallback", async () => {
    toIRTools.mockImplementationOnce(() => {
      throw new Error("tool conversion failed");
    });

    await expect(collect(streamChatWithTools({
      ...baseOpts,
      runId: "run_tool_init_failure",
      mcpServers: [{
        name: "demo",
        tools: [{ name: "echo" }],
        close: async () => undefined,
      }] as never,
    }))).rejects.toThrow("tool conversion failed");

    expect(telemetry.finalizeExecution).toHaveBeenCalledWith(expect.objectContaining({
      initial: expect.objectContaining({ requestId: "run_tool_init_failure" }),
      outcome: expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({ message: "tool conversion failed" }),
      }),
    }));
  });
});
