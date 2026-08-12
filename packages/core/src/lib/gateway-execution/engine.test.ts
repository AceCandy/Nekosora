import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { executeGateway } from "./engine";
import type {
  AttemptTelemetry,
  GatewayAdapterSelection,
  GatewayAttemptAdapter,
  GatewayBreakerPort,
  GatewayTelemetryPort,
} from "./types";
import type { ResolvedRoute } from "@/lib/providers/types";

interface Event { text: string }
interface Result { text: string }

function route(id: string, keys = [`key-${id}`], protocol: ResolvedRoute["protocol"] = "openai"):
  ResolvedRoute {
  return {
    modelName: "demo",
    upstreamModelName: `upstream-${id}`,
    protocol,
    provider: {
      id: `provider-${id}`,
      name: `Provider ${id}`,
      protocol,
      baseUrl: `https://${id}.example.test/v1`,
      apiKey: keys[0] ?? "",
      keys: keys.map((key) => ({ key, weight: 1 })),
    },
    priority: 0,
    weight: 1,
    source: "byo",
    routeId: id,
  };
}

function harness(
  routes: ResolvedRoute[],
  selectAdapter: (route: ResolvedRoute) =>
    | GatewayAttemptAdapter<Event, Result>
    | GatewayAdapterSelection<Event, Result>
    | null,
  abortSignal?: AbortSignal,
  options: {
    isToolUnsupported?: (error: unknown) => boolean;
    onToolUnsupported?: (route: ResolvedRoute) => Promise<void>;
    isStreamOptionsUnsupported?: (route: ResolvedRoute, error: unknown) => boolean;
    onStreamOptionsUnsupported?: (route: ResolvedRoute) => Promise<void>;
    onProviderStart?: () => Promise<void>;
  } = {},
) {
  const attempts: AttemptTelemetry[] = [];
  const finalized: unknown[] = [];
  const telemetry: GatewayTelemetryPort = {
    startExecution: vi.fn(async () => undefined),
    recordAttempt: vi.fn(async (input) => { attempts.push(input); }),
    finalizeExecution: vi.fn(async (input) => { finalized.push(input); }),
  };
  const permit = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    release: vi.fn(),
  };
  const breaker: GatewayBreakerPort = {
    acquire: vi.fn(() => permit),
    recordNoHealthyRoute: vi.fn(),
  };
  const generator = executeGateway<Event, Result>({
    ctx: { userId: "user-1", keyKind: null, source: "gateway" },
    requestId: "request-1",
    operation: "chat.stream",
    model: "demo",
    abortSignal,
    resolveRoutes: async () => routes,
    selectAdapter,
    onProviderStart: options.onProviderStart,
    isToolUnsupported: options.isToolUnsupported,
    onToolUnsupported: options.onToolUnsupported,
    isStreamOptionsUnsupported: options.isStreamOptionsUnsupported,
    onStreamOptionsUnsupported: options.onStreamOptionsUnsupported,
    telemetry,
    breaker,
  });
  return { generator, attempts, finalized, telemetry, breaker, permit };
}

async function consume<TEvent, TResult>(generator: AsyncGenerator<TEvent, TResult, void>) {
  const events: TEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, outcome: next.value };
    events.push(next.value);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("gateway execution engine", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("可转移失败先换 key，最终 execution 只终结一次", async () => {
    const calls: string[] = [];
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ apiKey }) {
      calls.push(apiKey);
      if (apiKey === "key-a") {
        throw Object.assign(new Error("temporary failure"), { statusCode: 503 });
      }
      return { value: { text: "ok" }, usage: { inputTokens: 2, outputTokens: 1 } };
    };
    const h = harness([route("a", ["key-a", "key-b"])], () => adapter);

    const { outcome } = await consume(h.generator);

    expect(calls).toEqual(["key-a", "key-b"]);
    expect(outcome).toMatchObject({ status: "success", result: { text: "ok" } });
    expect(h.attempts.map((item) => item.status)).toEqual(["failed", "success"]);
    expect(h.permit.recordFailure).toHaveBeenCalledOnce();
    expect(h.permit.recordSuccess).toHaveBeenCalledOnce();
    expect(h.permit.release).toHaveBeenCalledOnce();
    expect(h.finalized).toHaveLength(1);
  });

  it("在首个 adapter 前标记 Provider start，key 重试不重复标记", async () => {
    const calls: string[] = [];
    const onProviderStart = vi.fn(async () => {
      calls.push("provider-start");
    });
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ apiKey }) {
      calls.push(`adapter:${apiKey}`);
      if (apiKey === "key-a") {
        throw Object.assign(new Error("temporary failure"), { statusCode: 503 });
      }
      return { value: { text: "ok" } };
    };
    const h = harness(
      [route("a", ["key-a", "key-b"])],
      () => adapter,
      undefined,
      { onProviderStart },
    );

    const { outcome } = await consume(h.generator);

    expect(outcome.status).toBe("success");
    expect(calls).toEqual(["provider-start", "adapter:key-a", "adapter:key-b"]);
    expect(onProviderStart).toHaveBeenCalledOnce();
  });

  it("所有 route 的 permit 都被占用时不调用 adapter 并返回 no_healthy_route", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = vi.fn(async function* () {
      return { value: { text: "unexpected" } };
    });
    const h = harness([route("a"), route("b")], () => adapter);
    vi.mocked(h.breaker.acquire).mockReturnValue(null);

    const { outcome } = await consume(h.generator);

    expect(adapter).not.toHaveBeenCalled();
    expect(h.attempts).toEqual([]);
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: ErrorCode.ROUTING_NO_HEALTHY_ROUTE, phase: "routing" },
    });
    expect(h.breaker.recordNoHealthyRoute).toHaveBeenCalledOnce();
    expect(h.finalized).toHaveLength(1);
  });

  it("route 没有 Key 时中性释放 permit 且不调用 adapter", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = vi.fn(async function* () {
      return { value: { text: "unexpected" } };
    });
    const h = harness([route("a", [])], () => adapter);

    const { outcome } = await consume(h.generator);

    expect(adapter).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "failed", error: { code: "no_route" } });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.recordSuccess).not.toHaveBeenCalled();
    expect(h.permit.release).toHaveBeenCalledOnce();
  });

  it("Provider-start 失败时不创建 attempt、failover 或 breaker 事实", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = vi.fn(async function* () {
      return { value: { text: "unexpected" } };
    });
    const failure = Object.assign(new Error("governance unavailable"), {
      code: ErrorCode.SERVER_SERVICE_UNAVAILABLE,
      statusCode: 503,
    });
    const onProviderStart = vi.fn().mockRejectedValue(failure);
    const h = harness(
      [route("a"), route("b")],
      () => adapter,
      undefined,
      { onProviderStart },
    );

    const { outcome } = await consume(h.generator);

    expect(outcome).toMatchObject({
      status: "failed",
      route: { routeId: "a" },
      error: {
        code: ErrorCode.SERVER_SERVICE_UNAVAILABLE,
        phase: "internal",
        httpStatus: 503,
      },
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(h.attempts).toEqual([]);
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.recordSuccess).not.toHaveBeenCalled();
    expect(h.permit.release).toHaveBeenCalledOnce();
    expect(h.finalized).toHaveLength(1);
  });

  it("Provider-start 等待期间的 caller abort 保持 interrupted 语义", async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const onProviderStart = vi.fn().mockReturnValue(started.promise);
    const adapter: GatewayAttemptAdapter<Event, Result> = vi.fn(async function* () {
      return { value: { text: "unexpected" } };
    });
    const h = harness(
      [route("a")],
      () => adapter,
      controller.signal,
      { onProviderStart },
    );
    const executing = consume(h.generator);

    await vi.waitFor(() => expect(onProviderStart).toHaveBeenCalledOnce());
    controller.abort();
    started.resolve();
    const { outcome } = await executing;

    expect(outcome.status).toBe("interrupted");
    expect(adapter).not.toHaveBeenCalled();
    expect(h.attempts).toEqual([]);
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.release).toHaveBeenCalledOnce();
    expect(h.finalized).toHaveLength(1);
  });

  it("首 route 可转移失败后进入下一 route", async () => {
    const calls: string[] = [];
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      if (current.routeId === "a") throw Object.assign(new Error("down"), { statusCode: 503 });
      return { value: { text: "backup" } };
    };
    const h = harness([route("a"), route("b")], () => adapter);

    const { outcome } = await consume(h.generator);

    expect(calls).toEqual(["a", "b"]);
    expect(outcome.route?.routeId).toBe("b");
    expect(outcome.status).toBe("success");
  });

  it("工具能力拒绝复标具体路由、跳过剩余 key、继续下一路由且不污染 breaker", async () => {
    const calls: string[] = [];
    const onToolUnsupported = vi.fn(async () => undefined);
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      if (current.routeId === "a") {
        throw Object.assign(new Error("tools are not supported"), { statusCode: 400 });
      }
      return { value: { text: "backup" } };
    };
    const h = harness(
      [route("a", ["key-a", "key-b"]), route("b")],
      () => adapter,
      undefined,
      { isToolUnsupported: () => true, onToolUnsupported },
    );

    const { outcome } = await consume(h.generator);

    expect(calls).toEqual(["a", "b"]);
    expect(onToolUnsupported).toHaveBeenCalledOnce();
    expect(onToolUnsupported).toHaveBeenCalledWith(expect.objectContaining({ routeId: "a" }));
    expect(h.attempts[0]).toMatchObject({
      status: "failed",
      error: { code: "tools_not_supported", phase: "routing", httpStatus: 400 },
    });
    expect(outcome).toMatchObject({ status: "success", route: { routeId: "b" } });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.recordSuccess).toHaveBeenCalledOnce();
  });

  it("复标持久化失败不改变工具拒绝后的故障转移结果", async () => {
    const onToolUnsupported = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      if (current.routeId === "a") {
        throw Object.assign(new Error("tool_choice is not allowed"), { statusCode: 422 });
      }
      return { value: { text: "backup" } };
    };
    const h = harness(
      [route("a"), route("b")],
      () => adapter,
      undefined,
      { isToolUnsupported: () => true, onToolUnsupported },
    );

    const { outcome } = await consume(h.generator);

    expect(onToolUnsupported).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ status: "success", route: { routeId: "b" } });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
  });

  it("stream_options 拒绝后用同 route 和同 key 重试一次", async () => {
    const calls: string[] = [];
    let learned = false;
    const onStreamOptionsUnsupported = vi.fn(async (current: ResolvedRoute) => {
      current.provider.supportsStreamUsage = false;
      learned = true;
    });
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current, apiKey }) {
      calls.push(`${current.routeId}:${apiKey}:${learned}`);
      if (!learned) {
        throw Object.assign(
          new Error("invalid_request_error: Unsupported parameter: 'stream_options'."),
          { statusCode: 400 },
        );
      }
      return { value: { text: "ok" }, usage: { inputTokens: 2, outputTokens: 1 } };
    };
    const h = harness(
      [route("a", ["key-a", "key-b"], "openai-compatible")],
      () => adapter,
      undefined,
      {
        isStreamOptionsUnsupported: () => true,
        onStreamOptionsUnsupported,
      },
    );

    const { outcome } = await consume(h.generator);

    expect(calls).toEqual(["a:key-a:false", "a:key-a:true"]);
    expect(onStreamOptionsUnsupported).toHaveBeenCalledOnce();
    expect(h.attempts).toMatchObject([
      { status: "failed", error: { code: "stream_options_not_supported", phase: "routing" } },
      { status: "success" },
    ]);
    expect(outcome).toMatchObject({ status: "success", result: { text: "ok" } });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.recordSuccess).toHaveBeenCalledOnce();
    expect(h.finalized).toHaveLength(1);
  });

  it("stream_options 能力持久化失败不覆盖内存降级与重试结果", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      if (current.provider.supportsStreamUsage !== false) {
        throw Object.assign(new Error("stream_options is unsupported"), { statusCode: 400 });
      }
      return { value: { text: "ok" } };
    };
    const onStreamOptionsUnsupported = vi.fn(async (current: ResolvedRoute) => {
      current.provider.supportsStreamUsage = false;
      throw new Error("database unavailable");
    });
    const h = harness(
      [route("a", ["key-a"], "openai-compatible")],
      () => adapter,
      undefined,
      {
        isStreamOptionsUnsupported: () => true,
        onStreamOptionsUnsupported,
      },
    );

    const { outcome } = await consume(h.generator);

    expect(onStreamOptionsUnsupported).toHaveBeenCalledOnce();
    expect(h.attempts.map((attempt) => attempt.status)).toEqual(["failed", "success"]);
    expect(outcome).toMatchObject({ status: "success", result: { text: "ok" } });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
  });

  it("stream_options 降级后仍失败时不会循环重试", async () => {
    const calls: string[] = [];
    const onStreamOptionsUnsupported = vi.fn(async (current: ResolvedRoute) => {
      current.provider.supportsStreamUsage = false;
    });
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current, apiKey }) {
      calls.push(`${current.routeId}:${apiKey}`);
      throw Object.assign(
        new Error("invalid_request_error: Unsupported parameter: 'stream_options'."),
        { statusCode: 400 },
      );
    };
    const h = harness(
      [route("a", ["key-a", "key-b"], "openai-compatible"), route("b")],
      () => adapter,
      undefined,
      {
        isStreamOptionsUnsupported: () => true,
        onStreamOptionsUnsupported,
      },
    );

    const { outcome } = await consume(h.generator);

    expect(calls).toEqual(["a:key-a", "a:key-a"]);
    expect(onStreamOptionsUnsupported).toHaveBeenCalledOnce();
    expect(h.attempts.map((item) => item.status)).toEqual(["failed", "failed"]);
    expect(outcome.status).toBe("failed");
    expect(h.finalized).toHaveLength(1);
  });

  it("同一 execution 的后续 route 不会再次执行 stream_options 降级", async () => {
    const firstRoute = route("a", ["key-a"], "openai-compatible");
    const secondRoute = route("b", ["key-b"], "openai-compatible");
    secondRoute.provider = {
      ...secondRoute.provider,
      id: firstRoute.provider.id,
      baseUrl: firstRoute.provider.baseUrl,
    };
    const calls: string[] = [];
    const onStreamOptionsUnsupported = vi.fn(async (current: ResolvedRoute) => {
      current.provider.supportsStreamUsage = false;
    });
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      if (current.routeId === "a" && calls.length === 2) {
        throw Object.assign(new Error("temporary upstream failure"), { statusCode: 503 });
      }
      throw Object.assign(new Error("stream_options is unsupported"), { statusCode: 400 });
    };
    const h = harness(
      [firstRoute, secondRoute],
      () => adapter,
      undefined,
      {
        isStreamOptionsUnsupported: () => true,
        onStreamOptionsUnsupported,
      },
    );

    await consume(h.generator);

    expect(calls).toEqual(["a", "a", "b"]);
    expect(onStreamOptionsUnsupported).toHaveBeenCalledOnce();
    expect(h.attempts).toHaveLength(3);
    expect(h.finalized).toHaveLength(1);
  });

  it("响应已经提交后不执行 stream_options 降级", async () => {
    const onStreamOptionsUnsupported = vi.fn(async () => undefined);
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      yield { value: { text: "visible" }, commitsResponse: true };
      throw Object.assign(new Error("stream_options is unsupported"), { statusCode: 400 });
    };
    const h = harness(
      [route("a", ["key-a", "key-b"], "openai-compatible")],
      () => adapter,
      undefined,
      {
        isStreamOptionsUnsupported: () => true,
        onStreamOptionsUnsupported,
      },
    );

    const { events, outcome } = await consume(h.generator);

    expect(events).toEqual([{ text: "visible" }]);
    expect(onStreamOptionsUnsupported).not.toHaveBeenCalled();
    expect(h.attempts).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "failed", committed: true });
  });

  it.each([
    ["可见正文", "visible", 1_100, 100],
    ["非正文事件", "reasoning", undefined, undefined],
  ] as const)("%s commit 后失败不换路由，TTFT 只按正文记录", async (
    _label,
    text,
    firstTokenAt,
    firstTokenLatencyMs,
  ) => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const calls: string[] = [];
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current, apiKey }) {
      calls.push(`${current.routeId}:${apiKey}`);
      yield { value: { text }, commitsResponse: true, firstTokenAt };
      now = 1_200;
      throw Object.assign(new Error("late failure"), { statusCode: 503 });
    };
    const h = harness([route("a", ["key-a", "key-b"]), route("b")], () => adapter);

    const { events, outcome } = await consume(h.generator);

    expect(events).toEqual([{ text }]);
    expect(outcome).toMatchObject({ status: "failed", committed: true });
    expect(outcome.firstTokenAt).toBe(firstTokenAt);
    expect(calls).toEqual(["a:key-a"]);
    expect(h.attempts[0]?.firstTokenLatencyMs).toBe(firstTokenLatencyMs);
    expect((h.finalized[0] as { firstTokenLatencyMs?: number }).firstTokenLatencyMs)
      .toBe(firstTokenLatencyMs);
  });

  it("Abort 立即中断且不更新 breaker", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      throw abortError;
    };
    const h = harness([route("a"), route("b")], () => adapter);

    const { outcome } = await consume(h.generator);

    expect(outcome.status).toBe("interrupted");
    expect(h.attempts.map((item) => item.status)).toEqual(["interrupted"]);
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.recordSuccess).not.toHaveBeenCalled();
  });

  it("总读取超时在响应提交前记录失败并进入下一 route", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const first = route("a");
    first.provider.readTimeoutMs = 10_000;
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      if (current.routeId === "a") await blocked;
      return { value: { text: "backup" } };
    };
    const h = harness([first, route("b")], () => adapter);
    const executing = consume(h.generator);

    try {
      await vi.advanceTimersByTimeAsync(10_000);
      const { outcome } = await executing;

      expect(calls).toEqual(["a", "b"]);
      expect(h.attempts).toMatchObject([
        { status: "failed", error: { code: "gateway.timeout", httpStatus: 504 } },
        { status: "success" },
      ]);
      expect(h.permit.recordFailure).toHaveBeenCalledOnce();
      expect(h.finalized).toHaveLength(1);
      expect(outcome).toMatchObject({ status: "success", route: { routeId: "b" } });
    } finally {
      release();
    }
  });

  it("总读取超时在响应提交后停止且非阻塞关闭 iterator", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let closed = false;
    const calls: string[] = [];
    const first = route("a", ["key-a", "key-b"]);
    first.provider.readTimeoutMs = 10_000;
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      try {
        yield { value: { text: "visible" }, commitsResponse: true };
        await blocked;
        return { value: { text: "never" } };
      } finally {
        closed = true;
      }
    };
    const h = harness([first, route("b")], () => adapter);
    const executing = consume(h.generator);

    try {
      await vi.advanceTimersByTimeAsync(10_000);
      const { events, outcome } = await executing;

      expect(events).toEqual([{ text: "visible" }]);
      expect(calls).toEqual(["a"]);
      expect(h.attempts).toMatchObject([
        { status: "failed", error: { code: "gateway.timeout", httpStatus: 504 } },
      ]);
      expect(h.permit.recordFailure).toHaveBeenCalledOnce();
      expect(h.finalized).toHaveLength(1);
      expect(outcome).toMatchObject({ status: "failed", committed: true });
      expect(closed).toBe(false);
    } finally {
      release();
      await vi.waitFor(() => expect(closed).toBe(true));
    }
  });

  it("caller abort 先发生时仍记 interrupted 且不更新 breaker", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = route("a");
    first.provider.readTimeoutMs = 10_000;
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      markStarted();
      await blocked;
      return { value: { text: "never" } };
    };
    const h = harness([first, route("b")], () => adapter, caller.signal);
    const executing = consume(h.generator);

    await started;
    caller.abort(new DOMException("client closed", "AbortError"));
    try {
      const { outcome } = await executing;
      await vi.advanceTimersByTimeAsync(10_000);

      expect(outcome.status).toBe("interrupted");
      expect(h.attempts.map((item) => item.status)).toEqual(["interrupted"]);
      expect(h.permit.recordFailure).not.toHaveBeenCalled();
      expect(h.finalized).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      release();
    }
  });

  it("adapter 不响应 AbortSignal 时 engine 仍立即终结 execution", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const abortController = new AbortController();
    let release!: () => void;
    const never = new Promise<void>((resolve) => {
      release = resolve;
    });
    let adapterStarted = false;
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      adapterStarted = true;
      now = 1_100;
      yield {
        value: { text: "visible" },
        commitsResponse: true,
        firstTokenAt: now,
      };
      await never;
      return { value: { text: "never" } };
    };
    const h = harness([route("a")], () => adapter, abortController.signal);
    const executing = consume(h.generator);

    await vi.waitFor(() => expect(adapterStarted).toBe(true));
    abortController.abort();
    try {
      const result = await Promise.race([
        executing,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
      ]);

      expect(result).not.toBe("timeout");
      expect(result).toMatchObject({
        events: [{ text: "visible" }],
        outcome: { status: "interrupted", firstTokenAt: 1_100 },
      });
      expect(h.attempts.map((item) => item.status)).toEqual(["interrupted"]);
      expect(h.attempts[0]?.firstTokenLatencyMs).toBe(100);
      expect(h.finalized).toHaveLength(1);
      expect(h.finalized[0]).toMatchObject({
        outcome: { status: "interrupted", firstTokenAt: 1_100 },
        firstTokenLatencyMs: 100,
      });
    } finally {
      release();
    }
  });

  it("确定性请求错误不重试、不 failover、不污染 breaker", async () => {
    const calls: string[] = [];
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      throw new Error("invalid_request: context length exceeded");
    };
    const h = harness([route("a", ["key-a", "key-b"]), route("b")], () => adapter);

    const { outcome } = await consume(h.generator);

    expect(outcome.status).toBe("failed");
    expect(calls).toEqual(["a"]);
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.release).toHaveBeenCalledOnce();
  });

  it("协议不兼容记录 rejected attempt 后继续兼容 route", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      return { value: { text: "ok" } };
    };
    const h = harness(
      [route("a", undefined, "anthropic"), route("b")],
      (current) => current.protocol === "openai" ? adapter : null,
    );

    const { outcome } = await consume(h.generator);

    expect(outcome).toMatchObject({ status: "success", route: { routeId: "b" } });
    expect(h.attempts.map((item) => item.status)).toEqual(["rejected", "success"]);
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
  });

  it("显式拒绝不读取 key、不调用 adapter，并继续后续 route", async () => {
    const rejectedRoute = route("a");
    Object.defineProperty(rejectedRoute.provider, "keys", {
      get: () => {
        throw new Error("rejected route must not read keys");
      },
    });
    const calls: string[] = [];
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current }) {
      calls.push(current.routeId);
      return { value: { text: "ok" } };
    };
    const h = harness([rejectedRoute, route("b")], (current) => current.routeId === "a"
      ? {
          kind: "rejected",
          error: {
            code: "request.unsupported_parameter",
            message: "Unsupported parameter: 'messages[0].role'.",
            phase: "request",
            httpStatus: 400,
            details: { parameter: "messages[0].role" },
          },
        }
      : { kind: "selected", adapter });

    const { outcome } = await consume(h.generator);

    expect(calls).toEqual(["b"]);
    expect(h.attempts).toMatchObject([
      { status: "rejected", error: { code: "request.unsupported_parameter" } },
      { status: "success" },
    ]);
    expect(outcome).toMatchObject({ status: "success", route: { routeId: "b" } });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
  });

  it("全部 route 被拒绝时返回有序第一条确定性错误", async () => {
    const h = harness([route("a"), route("b")], (current) => ({
      kind: "rejected",
      error: {
        code: "request.unsupported_parameter",
        message: `Unsupported parameter: '${current.routeId}'.`,
        phase: "request",
        httpStatus: 400,
        details: { parameter: current.routeId },
      },
    }));

    const { outcome } = await consume(h.generator);

    expect(h.attempts.map((item) => item.status)).toEqual(["rejected", "rejected"]);
    expect(outcome).toMatchObject({
      status: "failed",
      route: { routeId: "a" },
      error: {
        code: "request.unsupported_parameter",
        message: "Unsupported parameter: 'a'.",
        httpStatus: 400,
        details: { parameter: "a" },
      },
    });
    expect(h.permit.recordFailure).not.toHaveBeenCalled();
    expect(h.permit.recordSuccess).not.toHaveBeenCalled();
    expect(h.permit.release).toHaveBeenCalledTimes(2);
  });

  it("存在真实 upstream attempt 时最终错误优先于 route rejection", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      throw Object.assign(new Error("real upstream failure"), { statusCode: 503 });
    };
    const h = harness([route("a"), route("b")], (current) => current.routeId === "a"
      ? {
          kind: "rejected",
          error: {
            code: "request.unsupported_parameter",
            message: "Unsupported parameter: 'messages[0].role'.",
            phase: "request",
            httpStatus: 400,
          },
        }
      : { kind: "selected", adapter });

    const { outcome } = await consume(h.generator);

    expect(h.attempts.map((item) => item.status)).toEqual(["rejected", "failed"]);
    expect(outcome).toMatchObject({
      status: "failed",
      route: { routeId: "b" },
      error: { code: "upstream_error", message: "real upstream failure", httpStatus: 503 },
    });
    expect(h.permit.recordFailure).toHaveBeenCalledOnce();
  });

  it("原始凭据和 route 地址不会进入 attempt 或最终 outcome", async () => {
    const secret = "SECRET_WITH_REGEX_[.*]";
    const headerSecret = "HEADER_SECRET";
    const currentRoute = route("a", [secret]);
    currentRoute.provider.headers = { "x-provider-token": headerSecret };
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      throw Object.assign(
        new Error(`failed for ${secret} via ${currentRoute.provider.baseUrl} with ${headerSecret}`),
        { statusCode: 503 },
      );
    };
    const h = harness([currentRoute], () => adapter);

    const { outcome } = await consume(h.generator);
    const serialized = JSON.stringify({ attempts: h.attempts, outcome });

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(currentRoute.provider.baseUrl);
    expect(serialized).not.toContain(headerSecret);
    expect(serialized).toContain("[REDACTED]");
  });

  it("telemetry port 失败不改变成功 outcome", async () => {
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* () {
      return { value: { text: "ok" } };
    };
    const h = harness([route("a")], () => adapter);
    vi.mocked(h.telemetry.startExecution).mockRejectedValueOnce(new Error("db down"));
    vi.mocked(h.telemetry.recordAttempt).mockRejectedValueOnce(new Error("db down"));
    vi.mocked(h.telemetry.finalizeExecution).mockRejectedValueOnce(new Error("db down"));

    const { outcome } = await consume(h.generator);

    expect(outcome).toMatchObject({ status: "success", result: { text: "ok" } });
  });
});
