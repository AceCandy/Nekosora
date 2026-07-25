import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  Output: { json: vi.fn(() => ({ kind: "json-output" })) },
}));

const callMcpTool = vi.fn();
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

const logUsage = vi.fn(async () => undefined);
vi.mock("@/lib/usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/usage")>("@/lib/usage");
  return {
    ...actual,
    logUsage: (...args: unknown[]) => logUsage(...args),
  };
});

import { streamText } from "ai";
import { streamChatWithTools } from "@/lib/stream";
import {
  resetRouteRepository,
  setRouteRepository,
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
      capabilities: {},
    }) : null,
    findEnabledModelByNameForOwner: async () => ({
      id: "model-a",
      name: "test-model",
      ownerUserId: "user-a",
      visibility: "private",
      enabled: true,
      capabilities: {},
    }),
    findEnabledRoutes: async () => [{
      route: {
        id: "route-a",
        modelId: "model-a",
        providerId: "provider-a",
        upstreamModelName: "upstream-model",
        priority: 0,
        weight: 1,
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

describe("streamChatWithTools agent loop finish signal", () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    encryptedKeys = encrypt(JSON.stringify({ keys: [{ key: "sk-test-fake", weight: 1 }] }));
  });

  beforeEach(() => {
    resetAllBreakers();
    setRouteRepository(makeSingleRouteRepository());
    vi.mocked(streamText).mockReset();
    callMcpTool.mockReset();
    toIRTools.mockClear();
    logUsage.mockClear();
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

  it("工具链:中间 finish 不外发,最终文本轮发一次 finish 且 usage 取终轮", async () => {
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
      "tool-call",
      "tool-result",
      "text-delta",
      "finish",
    ]);
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
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
    const usageLogs = logUsage.mock.calls.map((call) => call[0] as {
      status?: string;
      skipMetrics?: boolean;
      attempt?: number;
    });
    expect(usageLogs.filter((entry) => entry.attempt === 1)).toEqual([
      expect.objectContaining({ status: "failed", skipMetrics: true }),
    ]);
    expect(usageLogs.filter((entry) => entry.attempt == null)).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
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

    const successLogs = logUsage.mock.calls
      .map((c) => c[0] as {
        status?: string;
        runId?: string;
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        providerName?: string;
        routeId?: string;
        routeName?: string;
        upstreamModel?: string;
        firstTokenLatencyMs?: number;
      })
      .filter((p) => p.status === "success");

    expect(successLogs).toHaveLength(1);
    expect(successLogs.every((p) => p.runId === "run_shared")).toBe(true);
    expect(successLogs[0].usage).toMatchObject({
      inputTokens: 6,
      outputTokens: 10,
      totalTokens: 16,
    });
    expect(successLogs[0]).toMatchObject({
      providerName: "Provider A",
      routeId: "route-a",
      routeName: "Provider A · upstream-model",
      upstreamModel: "upstream-model",
    });
    expect(successLogs[0].firstTokenLatencyMs).toEqual(expect.any(Number));
  });

  it("maxSteps=0 时写入唯一 interrupted fallback", async () => {
    await collect(streamChatWithTools({
      ...baseOpts,
      runId: "run_zero_steps",
      taskKind: "memory",
      maxSteps: 0,
    }));

    expect(streamText).not.toHaveBeenCalled();
    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      ctx: baseOpts.ctx,
      runId: "run_zero_steps",
      model: "test-model",
      status: "interrupted",
      errorCode: "interrupted",
      stream: true,
      taskKind: "memory",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
      providerRef: undefined,
      routeId: undefined,
      firstTokenLatencyMs: undefined,
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

    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run_pre_step_failure",
      model: "test-model",
      status: "failed",
      errorCode: "generation_failed",
      errorMessage: "messages unavailable",
      stream: true,
      usage: expect.objectContaining({
        inputTokens: 0,
        outputTokens: 0,
      }),
    }));
  });

  it("maxSteps 耗尽且仍 tool-calls 时不发最终 finish", async () => {
    vi.mocked(streamText).mockImplementation(() => mockStreamResult(
      [{
        type: "tool-call",
        toolCallId: "tc-loop",
        toolName: "demo__echo",
        input: {},
      }],
      "tool-calls",
    ));
    callMcpTool.mockResolvedValue({ result: "loop", isError: false });

    const events = await collect(streamChatWithTools({
      ...baseOpts,
      maxSteps: 2,
    }));

    expect(events.filter((e) => e.type === "tool-call")).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool-result")).toHaveLength(2);
    expect(events.some((e) => e.type === "finish")).toBe(false);
    const terminalLogs = logUsage.mock.calls
      .map((c) => c[0] as { status?: string; errorCode?: string })
      .filter((p) => p.status === "interrupted");
    expect(terminalLogs).toHaveLength(1);
    expect(terminalLogs[0].errorCode).toBe("interrupted");
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

    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run_tool_init_failure",
      status: "failed",
      errorCode: "generation_failed",
      errorMessage: "tool conversion failed",
    }));
  });
});
