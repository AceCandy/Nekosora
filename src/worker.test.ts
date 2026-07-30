import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateEnv: vi.fn(),
  getQueue: vi.fn(),
  createWorkerRuntime: vi.fn(),
  controllerStart: vi.fn(),
  definitions: [{ job: { name: "test-job" } }],
}));

vi.mock("@/lib/infra/env", () => ({ validateEnv: mocks.validateEnv }));
vi.mock("@/lib/infra/queue", () => ({ getQueue: mocks.getQueue }));
vi.mock("@/lib/worker/definitions", () => ({
  WORKER_DEFINITIONS: mocks.definitions,
}));
vi.mock("@/lib/worker/runtime", () => ({
  createWorkerRuntime: mocks.createWorkerRuntime,
}));

describe("worker entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateEnv.mockReset();
    mocks.getQueue.mockResolvedValue({ name: "queue" });
    mocks.controllerStart.mockResolvedValue(undefined);
    mocks.createWorkerRuntime.mockReturnValue({ start: mocks.controllerStart });
  });

  it("校验环境后组装并启动 runtime", async () => {
    const runtimeProcess = { on: vi.fn(), exit: vi.fn() };
    const { startWorker } = await import("@/worker");

    await startWorker(runtimeProcess);

    expect(mocks.validateEnv).toHaveBeenCalledOnce();
    expect(mocks.getQueue).toHaveBeenCalledOnce();
    expect(mocks.createWorkerRuntime).toHaveBeenCalledWith({
      queue: { name: "queue" },
      definitions: mocks.definitions,
      process: runtimeProcess,
    });
    expect(mocks.controllerStart).toHaveBeenCalledOnce();
  });

  it("环境校验失败时不加载 queue/runtime 副作用", async () => {
    const validationError = new Error("invalid environment");
    mocks.validateEnv.mockImplementation(() => {
      throw validationError;
    });
    const { startWorker } = await import("@/worker");

    await expect(startWorker({ on: vi.fn(), exit: vi.fn() }))
      .rejects.toBe(validationError);

    expect(mocks.getQueue).not.toHaveBeenCalled();
    expect(mocks.createWorkerRuntime).not.toHaveBeenCalled();
  });

  it("runtime 启动失败时保留原错误", async () => {
    const startupError = new Error("runtime failed");
    mocks.controllerStart.mockRejectedValueOnce(startupError);
    const { startWorker } = await import("@/worker");

    await expect(startWorker({ on: vi.fn(), exit: vi.fn() }))
      .rejects.toBe(startupError);
  });
});
