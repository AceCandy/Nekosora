import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GATEWAY_GOVERNANCE_POLICY } from "./policy";
import {
  GOVERNANCE_HEARTBEAT_INTERVAL_MS,
  GatewayGovernanceHandle,
  acquireGatewayGovernanceLease,
  beginGatewayGovernance,
  runWithGatewayGovernance,
  startGatewayGovernanceReaper,
} from "./lifecycle";
import {
  GatewayGovernanceRepository,
  GovernanceRejectedError,
  GovernanceStateError,
  type GovernanceLease,
} from "./repository";

const metrics = vi.hoisted(() => ({
  observeGatewayGovernanceFailure: vi.fn(),
  observeGatewayGovernanceRejection: vi.fn(),
  observeGatewayGovernanceSettlement: vi.fn(),
}));

vi.mock("@/lib/infra/metrics", () => metrics);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("gateway governance lifecycle", () => {
  it("marks Provider start and finalizes at most once", async () => {
    const repository = repositoryMock({
      finalize: vi.fn().mockResolvedValue({
        settled: true,
        quotaKind: "image_count",
        actualUnits: 7,
        overage: true,
      }),
    });
    const handle = createHandle(repository);

    await Promise.all([handle.markProviderStarted(), handle.markProviderStarted()]);
    await Promise.all([handle.finalize(7), handle.finalize(7)]);

    expect(repository.markProviderStarted).toHaveBeenCalledTimes(1);
    expect(repository.finalize).toHaveBeenCalledTimes(1);
    expect(repository.finalize).toHaveBeenCalledWith(lease.id, 7);
    expect(metrics.observeGatewayGovernanceSettlement).toHaveBeenCalledOnce();
    expect(metrics.observeGatewayGovernanceSettlement).toHaveBeenCalledWith({
      quotaKind: "image_count",
      outcome: "overage",
    });
  });

  it("records invalid policy fallback and a rate rejection without acquiring a lease", async () => {
    const rejection = new GovernanceRejectedError({
      reason: "rate",
      scope: "user",
      retryAfterSeconds: 2,
    });
    const repository = repositoryMock({
      loadPolicy: vi.fn().mockResolvedValue({
        policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
        source: "invalid",
      }),
      consumeRate: vi.fn().mockRejectedValue(rejection),
    });

    await expect(beginGatewayGovernance({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "image.generate",
      repository,
    })).rejects.toBe(rejection);

    expect(metrics.observeGatewayGovernanceFailure).toHaveBeenCalledWith("policy_invalid");
    expect(metrics.observeGatewayGovernanceRejection).toHaveBeenCalledWith({
      reason: "rate",
      scope: "user",
      operation: "image.generate",
    });
    expect(repository.acquireLease).not.toHaveBeenCalled();
  });

  it("records every affected scope while preserving one client rejection", async () => {
    const rejection = new GovernanceRejectedError({
      reason: "rate",
      scope: "user",
      retryAfterSeconds: 2,
      affectedScopes: ["key", "user"],
    });
    const repository = repositoryMock({
      consumeRate: vi.fn().mockRejectedValue(rejection),
    });

    await expect(beginGatewayGovernance({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "image.generate",
      repository,
    })).rejects.toBe(rejection);

    expect(metrics.observeGatewayGovernanceRejection).toHaveBeenCalledTimes(2);
    expect(metrics.observeGatewayGovernanceRejection).toHaveBeenNthCalledWith(1, {
      reason: "rate",
      scope: "key",
      operation: "image.generate",
    });
    expect(metrics.observeGatewayGovernanceRejection).toHaveBeenNthCalledWith(2, {
      reason: "rate",
      scope: "user",
      operation: "image.generate",
    });
  });

  it("acquires a lease from an already checked policy without consuming rate again", async () => {
    const repository = repositoryMock();

    const handle = await acquireGatewayGovernanceLease({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "mcp.search",
      policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      repository,
    });

    expect(repository.loadPolicy).not.toHaveBeenCalled();
    expect(repository.consumeRate).not.toHaveBeenCalled();
    expect(repository.acquireLease).toHaveBeenCalledWith({
      identity: { userId: "user-1", apiKeyId: "key-1" },
      operation: "mcp.search",
      policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
    });
    await handle.finalize();
  });

  it("records a quota rejection and stops the rejected lease heartbeat", async () => {
    vi.useFakeTimers();
    const rejection = new GovernanceRejectedError({
      reason: "quota",
      scope: "key",
      quotaKind: "image_count",
      retryAfterSeconds: 60,
    });
    const repository = repositoryMock({
      reserveQuota: vi.fn().mockRejectedValue(rejection),
    });
    const handle = createHandle(repository);

    await expect(handle.reserveQuota("image_count", 1)).rejects.toBe(rejection);
    await vi.advanceTimersByTimeAsync(GOVERNANCE_HEARTBEAT_INTERVAL_MS * 2);

    expect(metrics.observeGatewayGovernanceRejection).toHaveBeenCalledWith({
      reason: "quota",
      scope: "key",
      operation: "image.generate",
    });
    expect(repository.heartbeat).not.toHaveBeenCalled();
  });

  it("keeps heartbeat single-flight and waits for it before settlement", async () => {
    vi.useFakeTimers();
    const first = deferred<Date>();
    const repository = repositoryMock({
      heartbeat: vi.fn().mockReturnValue(first.promise),
    });
    const handle = createHandle(repository);

    await vi.advanceTimersByTimeAsync(GOVERNANCE_HEARTBEAT_INTERVAL_MS);
    expect(repository.heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GOVERNANCE_HEARTBEAT_INTERVAL_MS * 2);
    expect(repository.heartbeat).toHaveBeenCalledTimes(1);

    const finalization = handle.finalize(3);
    expect(repository.finalize).not.toHaveBeenCalled();
    first.resolve(new Date());
    await finalization;
    expect(repository.finalize).toHaveBeenCalledTimes(1);
  });

  it("aborts with a governance reason when heartbeat fails", async () => {
    vi.useFakeTimers();
    const failure = new GovernanceStateError("heartbeat failed");
    const repository = repositoryMock({
      heartbeat: vi.fn().mockRejectedValue(failure),
    });
    const handle = createHandle(repository);

    await vi.advanceTimersByTimeAsync(GOVERNANCE_HEARTBEAT_INTERVAL_MS);
    expect(handle.signal.aborted).toBe(true);
    expect(handle.signal.reason).toBe(failure);
    await expect(handle.finalize()).rejects.toBe(failure);
    expect(repository.finalize).toHaveBeenCalledTimes(1);
    expect(metrics.observeGatewayGovernanceFailure).toHaveBeenCalledWith("heartbeat");
  });

  it("does not let a metrics failure change settlement", async () => {
    metrics.observeGatewayGovernanceSettlement.mockImplementation(() => {
      throw new Error("metrics unavailable");
    });
    const repository = repositoryMock({
      finalize: vi.fn().mockResolvedValue({
        settled: true,
        quotaKind: "image_count",
        actualUnits: 1,
      }),
    });

    await expect(createHandle(repository).finalize(1)).resolves.toMatchObject({ settled: true });
  });

  it("settles once after success and after an operation failure", async () => {
    const successRepository = repositoryMock();
    await expect(runWithGatewayGovernance(
      createHandle(successRepository),
      async () => ({ value: "ok", actualUnits: 4 }),
    )).resolves.toBe("ok");
    expect(successRepository.finalize).toHaveBeenCalledWith(lease.id, 4);

    const failureRepository = repositoryMock();
    const failure = new Error("operation failed");
    await expect(runWithGatewayGovernance(
      createHandle(failureRepository),
      async () => { throw failure; },
    )).rejects.toBe(failure);
    expect(failureRepository.finalize).toHaveBeenCalledWith(lease.id, undefined);
  });

  it("lets a settlement failure override an operation failure", async () => {
    const settlementFailure = new GovernanceStateError("settlement failed");
    const repository = repositoryMock({
      finalize: vi.fn().mockRejectedValue(settlementFailure),
    });

    await expect(runWithGatewayGovernance(
      createHandle(repository),
      async () => { throw new Error("operation failed"); },
    )).rejects.toBe(settlementFailure);
  });

  it("stops future heartbeats on caller abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const repository = repositoryMock();
    const handle = createHandle(repository, controller.signal);

    controller.abort("caller closed");
    await vi.advanceTimersByTimeAsync(GOVERNANCE_HEARTBEAT_INTERVAL_MS * 2);
    expect(handle.signal.aborted).toBe(true);
    expect(handle.signal.reason).toBe("caller closed");
    expect(repository.heartbeat).not.toHaveBeenCalled();
    await handle.finalize();
  });

  it("runs the reaper single-flight and waits for stop", async () => {
    vi.useFakeTimers();
    const first = deferred<boolean>();
    const repository = repositoryMock({
      reapExpiredOne: vi.fn().mockReturnValue(first.promise),
    });
    const controller = startGatewayGovernanceReaper({
      repository,
      intervalMs: 10,
      batchSize: 2,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(repository.reapExpiredOne).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30);
    expect(repository.reapExpiredOne).toHaveBeenCalledTimes(1);

    const stopped = controller.stop();
    first.resolve(false);
    await stopped;
    await vi.advanceTimersByTimeAsync(30);
    expect(repository.reapExpiredOne).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["40P01", "40P01"],
    ["SECRET_DATA", "unknown"],
  ])("reports bounded diagnostic code %s as %s", async (code, expected) => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const databaseError = Object.assign(new Error("postgres://secret"), { code });
    const repository = repositoryMock({
      reapExpiredOne: vi.fn().mockRejectedValue(
        Object.assign(new Error("query and params"), { cause: databaseError }),
      ),
    });
    const controller = startGatewayGovernanceReaper({
      repository,
      onFailure,
      intervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(onFailure).toHaveBeenCalledWith(expected);
    await controller.stop();
  });
});

const lease: GovernanceLease = {
  id: "lease-1",
  keySubjectId: "key-subject",
  userSubjectId: "user-subject",
  operation: "image.generate",
  expiresAt: new Date(Date.now() + 120_000),
};

function createHandle(
  repository: GatewayGovernanceRepository,
  requestSignal?: AbortSignal,
): GatewayGovernanceHandle {
  return new GatewayGovernanceHandle({
    lease,
    policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
    repository,
    requestSignal,
  });
}

function repositoryMock(overrides: Record<string, unknown> = {}): GatewayGovernanceRepository {
  return {
    loadPolicy: vi.fn().mockResolvedValue({
      policy: DEFAULT_GATEWAY_GOVERNANCE_POLICY,
      source: "default",
    }),
    consumeRate: vi.fn().mockResolvedValue(undefined),
    acquireLease: vi.fn().mockResolvedValue(lease),
    reserveQuota: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(new Date()),
    markProviderStarted: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue({ settled: true }),
    reapExpiredOne: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as GatewayGovernanceRepository;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
