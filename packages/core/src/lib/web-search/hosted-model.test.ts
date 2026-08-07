import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeAtomicGateway: vi.fn(),
  getChatUA: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: mocks.streamText };
});
vi.mock("@/lib/gateway-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gateway-execution")>();
  return { ...actual, executeAtomicGateway: mocks.executeAtomicGateway };
});
vi.mock("@/lib/system-settings/ua", () => ({ getChatUA: mocks.getChatUA }));

import {
  buildHostedSearchPrompt,
  executeHostedModelSearch,
  normalizeHostedSources,
} from "./hosted-model";

const hostedRoute = {
  modelId: "model-uuid",
  modelName: "GPT 5.6 Luna",
  upstreamModelName: "gpt-5.6-luna",
  protocol: "openai" as const,
  provider: {
    id: "openai",
    name: "OpenAI",
    protocol: "openai" as const,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-key",
    keys: [{ key: "test-key", weight: 1 }],
  },
  priority: 0,
  weight: 1,
  source: "byo" as const,
  routeId: "route-1",
  capabilities: { tools: true, webSearchFormat: "openai" as const },
  supportsTools: true,
};

function useAdapterGateway() {
  mocks.executeAtomicGateway.mockImplementation(async (options) => {
    const adapter = options.selectAdapter(hostedRoute);
    expect(adapter).not.toBeNull();
    try {
      const next = await adapter!({
        executionId: "execution-1",
        attempt: 1,
        operation: "chat.generate",
        route: hostedRoute,
        apiKey: "test-key",
        abortSignal: options.abortSignal,
      }).next();
      expect(next.done).toBe(true);
      return {
        executionId: "execution-1",
        status: "success",
        result: next.value.value,
        usage: next.value.usage ?? {},
        committed: false,
      };
    } catch {
      return {
        executionId: "execution-1",
        status: "interrupted",
        usage: {},
        committed: false,
      };
    }
  });
}

function createControlledStream() {
  const queue: unknown[] = [];
  let settle: ((value: unknown) => void) | undefined;
  const done = Symbol("done");

  const push = (part: unknown) => {
    if (settle) {
      const resolve = settle;
      settle = undefined;
      resolve(part);
    } else {
      queue.push(part);
    }
  };
  const next = (signal: AbortSignal) => {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      settle = (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
    });
  };

  return {
    push,
    end: () => push(done),
    result: (signal: AbortSignal, abortAsPart = false) => ({
      fullStream: (async function* () {
        try {
          while (true) {
            const part = await next(signal);
            if (part === done) return;
            yield part;
          }
        } catch (error) {
          if (abortAsPart && signal.aborted) {
            yield { type: "abort" };
            return;
          }
          throw error;
        }
      })(),
      text: Promise.resolve(" grounded summary "),
      sources: Promise.resolve([{
        sourceType: "url",
        url: "https://example.com/source",
        title: "Source",
      }]),
      usage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        inputTokenDetails: {},
        outputTokenDetails: {},
      }),
    }),
  };
}

function hostedSearch(signal = new AbortController().signal) {
  return executeHostedModelSearch({
    ctx: { userId: "user", keyKind: null, source: "chat" },
    modelId: "model-uuid",
    modelName: "model-uuid",
    query: "latest news",
    runId: "run-1",
    toolCallId: "tool-1",
    signal,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChatUA.mockResolvedValue("test-ua");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildHostedSearchPrompt", () => {
  it("注入当前日期并要求最新问题核对来源日期", () => {
    const prompt = buildHostedSearchPrompt(
      "最新的模型发布信息",
      new Date("2026-08-03T12:00:00.000Z"),
    );

    expect(prompt).toContain("当前日期（UTC）：2026-08-03");
    expect(prompt).toContain("发布日期或更新时间更近");
    expect(prompt).toContain("问题：最新的模型发布信息");
  });

  it("将不支持原生过滤的时间范围写入搜索提示词", () => {
    const prompt = buildHostedSearchPrompt(
      "OpenAI 最新动态",
      new Date("2026-08-07T12:00:00.000Z"),
      { preset: "week", startDate: "2026-08-01", endDate: "2026-08-07" },
    );

    expect(prompt).toContain("检索时间范围（UTC，含首尾日期）：2026-08-01 至 2026-08-07");
    expect(prompt).toContain("范围外信息仅可作为必要背景并明确说明");
  });

  it("保留来源提供的合法发布日期", () => {
    expect(normalizeHostedSources([{
      sourceType: "url",
      url: "https://example.com/news",
      title: "News",
      publishedAt: "2026-08-03",
    }])).toEqual([{
      title: "News",
      url: "https://example.com/news",
      snippet: "",
      publishedAt: "2026-08-03T00:00:00.000Z",
    }]);
  });
});

describe("executeHostedModelSearch", () => {
  it("30 秒内没有有效上游进度时按超时结束", async () => {
    vi.useFakeTimers();
    useAdapterGateway();
    const stream = createControlledStream();
    mocks.streamText.mockImplementation(({ abortSignal }) => stream.result(abortSignal, true));

    const result = hostedSearch();
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(0);
    stream.push({ type: "start" });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
  });

  it("持续收到有效进度时允许总耗时超过 60 秒并保留摘要与来源", async () => {
    vi.useFakeTimers();
    useAdapterGateway();
    const stream = createControlledStream();
    mocks.streamText.mockImplementation(({ abortSignal }) => stream.result(abortSignal));

    const result = hostedSearch();
    await vi.advanceTimersByTimeAsync(29_000);
    stream.push({ type: "text-delta", id: "text-1", text: "a" });
    await vi.advanceTimersByTimeAsync(29_000);
    stream.push({ type: "reasoning-delta", id: "reasoning-1", text: "b" });
    await vi.advanceTimersByTimeAsync(29_000);
    stream.push({
      type: "source",
      sourceType: "url",
      id: "source-1",
      url: "https://example.com/source",
    });
    await vi.advanceTimersByTimeAsync(0);
    stream.end();

    await expect(result).resolves.toEqual({
      summary: "grounded summary",
      citations: [{
        title: "Source",
        url: "https://example.com/source",
        snippet: "",
      }],
      modelId: "model-uuid",
      modelName: "GPT 5.6 Luna",
    });
  });

  it("流开始后连续 30 秒无进度时按超时结束", async () => {
    vi.useFakeTimers();
    useAdapterGateway();
    const stream = createControlledStream();
    mocks.streamText.mockImplementation(({ abortSignal }) => stream.result(abortSignal));

    const result = hostedSearch();
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(0);
    stream.push({ type: "text-delta", id: "text-1", text: "a" });
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
  });

  it("选中 Hosted 路由时立即上报可读模型身份", async () => {
    mocks.executeAtomicGateway.mockImplementation(async (options) => {
      const adapter = options.selectAdapter(hostedRoute);
      expect(adapter).not.toBeNull();
      return { status: "failed", error: { code: "upstream_error" } };
    });
    const onRouteSelected = vi.fn();

    await executeHostedModelSearch({
      ctx: { userId: "user", keyKind: null, source: "chat" },
      modelId: "model-uuid",
      modelName: "model-uuid",
      query: "latest news",
      runId: "run-1",
      toolCallId: "tool-1",
      signal: new AbortController().signal,
      onRouteSelected,
    });

    expect(onRouteSelected).toHaveBeenCalledWith({
      modelId: "model-uuid",
      modelName: "GPT 5.6 Luna",
    });
  });
});
