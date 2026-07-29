import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeGateway } from "./engine";
import type {
  AttemptTelemetry,
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

function harness(routes: ResolvedRoute[], selectAdapter: (route: ResolvedRoute) => GatewayAttemptAdapter<Event, Result> | null) {
  const attempts: AttemptTelemetry[] = [];
  const finalized: unknown[] = [];
  const telemetry: GatewayTelemetryPort = {
    startExecution: vi.fn(async () => undefined),
    recordAttempt: vi.fn(async (input) => { attempts.push(input); }),
    finalizeExecution: vi.fn(async (input) => { finalized.push(input); }),
  };
  const breaker: GatewayBreakerPort = {
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const generator = executeGateway<Event, Result>({
    ctx: { userId: "user-1", keyKind: null, source: "gateway" },
    requestId: "request-1",
    operation: "chat.stream",
    model: "demo",
    resolveRoutes: async () => routes,
    selectAdapter,
    telemetry,
    breaker,
  });
  return { generator, attempts, finalized, telemetry, breaker };
}

async function consume<TEvent, TResult>(generator: AsyncGenerator<TEvent, TResult, void>) {
  const events: TEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, outcome: next.value };
    events.push(next.value);
  }
}

describe("gateway execution engine", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
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
    expect(h.breaker.recordFailure).toHaveBeenCalledOnce();
    expect(h.breaker.recordSuccess).toHaveBeenCalledOnce();
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

  it("事件 commit 后失败不再换 key 或 route", async () => {
    const calls: string[] = [];
    const adapter: GatewayAttemptAdapter<Event, Result> = async function* ({ route: current, apiKey }) {
      calls.push(`${current.routeId}:${apiKey}`);
      yield { value: { text: "visible" }, commitsResponse: true };
      throw Object.assign(new Error("late failure"), { statusCode: 503 });
    };
    const h = harness([route("a", ["key-a", "key-b"]), route("b")], () => adapter);

    const { events, outcome } = await consume(h.generator);

    expect(events).toEqual([{ text: "visible" }]);
    expect(outcome).toMatchObject({ status: "failed", committed: true });
    expect(calls).toEqual(["a:key-a"]);
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
    expect(h.breaker.recordFailure).not.toHaveBeenCalled();
    expect(h.breaker.recordSuccess).not.toHaveBeenCalled();
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
    expect(h.breaker.recordFailure).not.toHaveBeenCalled();
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
    expect(h.breaker.recordFailure).not.toHaveBeenCalled();
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
