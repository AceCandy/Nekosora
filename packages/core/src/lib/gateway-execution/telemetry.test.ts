import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
  observeGatewayAttempt: vi.fn(),
  observeGatewayExecution: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq }));
vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));
vi.mock("@/lib/infra/metrics", () => ({
  observeGatewayAttempt: mocks.observeGatewayAttempt,
  observeGatewayExecution: mocks.observeGatewayExecution,
}));

import { gatewayTelemetry } from "./telemetry";
import type {
  AttemptTelemetry,
  FinalExecutionTelemetry,
  GatewayRouteSnapshot,
  StartExecutionTelemetry,
} from "./types";

const schema = {
  gatewayExecutions: { id: "gatewayExecutions.id" },
  gatewayAttempts: "gatewayAttempts",
};

const initial: StartExecutionTelemetry = {
  executionId: "execution-1",
  requestId: "request-1",
  operation: "chat.stream",
  ctx: { userId: "user-1", apiKeyId: "api-key-1", keyKind: "primary", source: "gateway" },
  model: "demo",
  modelId: "model-1",
  requestPath: "/v1/chat/completions",
  stream: true,
  startedAt: 1_000,
};

const route: GatewayRouteSnapshot = {
  modelName: "demo",
  upstreamModelName: "upstream-demo",
  protocol: "openai",
  provider: { id: "provider-1", name: "Provider 1" },
  priority: 0,
  weight: 1,
  source: "byo",
  routeId: "route-1",
};

const attempt: AttemptTelemetry = {
  executionId: initial.executionId,
  attempt: 1,
  operation: initial.operation,
  route,
  upstreamKeyMasked: "sk-***xyz",
  status: "success",
  usage: { inputTokens: 3, outputTokens: 2 },
  latencyMs: 20,
  startedAt: 1_010,
  completedAt: 1_030,
};

function createDb() {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
  };
  return { db, insertValues, updateSet, updateWhere };
}

let db = createDb();

beforeEach(() => {
  vi.clearAllMocks();
  db = createDb();
  mocks.getDb.mockResolvedValue(db.db);
  mocks.getSchema.mockReturnValue(schema);
});

describe("gateway telemetry repository", () => {
  it("创建 running execution", async () => {
    await gatewayTelemetry.startExecution(initial);

    expect(db.db.insert).toHaveBeenCalledWith(schema.gatewayExecutions);
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: "execution-1",
      requestId: "request-1",
      operation: "chat.stream",
      status: "running",
      startedAt: new Date(1_000),
    }));
  });

  it("记录单次 attempt 并更新低基数指标", async () => {
    await gatewayTelemetry.recordAttempt(attempt);

    expect(db.db.insert).toHaveBeenCalledWith(schema.gatewayAttempts);
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      executionId: "execution-1",
      attempt: 1,
      status: "success",
      providerProtocol: "openai",
      promptTokens: 3,
      completionTokens: 2,
    }));
    expect(mocks.observeGatewayAttempt).toHaveBeenCalledWith({
      operation: "chat.stream",
      status: "success",
      protocol: "openai",
    });
  });

  it("终结 execution 并按 execution id 更新", async () => {
    const final: FinalExecutionTelemetry<{ text: string }> = {
      initial,
      outcome: {
        executionId: initial.executionId,
        status: "success",
        result: { text: "ok" },
        usage: { inputTokens: 3, outputTokens: 2 },
        route,
        committed: true,
      },
      latencyMs: 50,
      firstTokenLatencyMs: 10,
      completedAt: 1_050,
    };

    await gatewayTelemetry.finalizeExecution(final);

    expect(db.db.update).toHaveBeenCalledWith(schema.gatewayExecutions);
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      providerRef: "byo:provider-1",
      latencyMs: 50,
      completedAt: new Date(1_050),
    }));
    expect(mocks.eq).toHaveBeenCalledWith(schema.gatewayExecutions.id, "execution-1");
    expect(db.updateWhere).toHaveBeenCalledWith({
      left: schema.gatewayExecutions.id,
      right: "execution-1",
    });
    expect(mocks.observeGatewayExecution).toHaveBeenCalledWith(expect.objectContaining({
      operation: "chat.stream",
      status: "success",
      latencyMs: 50,
    }));
  });

  it("数据库和 metrics 失败均不改变调用方结果", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getDb.mockRejectedValue(new Error("db unavailable"));
    mocks.observeGatewayAttempt.mockImplementation(() => {
      throw new Error("metrics unavailable");
    });
    mocks.observeGatewayExecution.mockImplementation(() => {
      throw new Error("metrics unavailable");
    });

    await expect(gatewayTelemetry.startExecution(initial)).resolves.toBeUndefined();
    await expect(gatewayTelemetry.recordAttempt(attempt)).resolves.toBeUndefined();
    await expect(gatewayTelemetry.finalizeExecution({
      initial,
      outcome: {
        executionId: initial.executionId,
        status: "failed",
        usage: {},
        committed: false,
      },
      latencyMs: 50,
      completedAt: 1_050,
    })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(3);
    errorSpy.mockRestore();
  });

  it("attempt 与 final error 写库前再次脱敏", async () => {
    const secretMessage =
      "https://example.test/models?key=QUERY_SECRET Authorization: Bearer HEADER_SECRET";

    await gatewayTelemetry.recordAttempt({
      ...attempt,
      status: "failed",
      error: { code: "upstream_error", phase: "upstream", message: secretMessage },
    });
    await gatewayTelemetry.finalizeExecution({
      initial,
      outcome: {
        executionId: initial.executionId,
        status: "failed",
        usage: {},
        error: { code: "upstream_error", phase: "upstream", message: secretMessage },
        committed: false,
      },
      latencyMs: 50,
      completedAt: 1_050,
    });

    const redacted =
      "https://example.test/models?key=[REDACTED] Authorization: Bearer [REDACTED]";
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: redacted }));
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: redacted }));
    expect(JSON.stringify([db.insertValues.mock.calls, db.updateSet.mock.calls])).not.toContain(
      "QUERY_SECRET",
    );
  });
});
