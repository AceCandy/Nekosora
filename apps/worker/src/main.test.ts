import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  validateEnv: vi.fn(),
  bootstrapDatabase: vi.fn(),
  configureQueueProvider: vi.fn(),
  getQueue: vi.fn(),
  closeQueue: vi.fn(),
  closeDb: vi.fn(),
  startHealthServer: vi.fn(),
  createWorkerRuntime: vi.fn(),
}));

vi.mock("@nekusora/core/env", () => ({ validateEnv: mocks.validateEnv }));
vi.mock("@nekusora/core/bootstrap", () => ({ bootstrapDatabase: mocks.bootstrapDatabase }));
vi.mock("@nekusora/core/queue", () => ({ configureQueueProvider: mocks.configureQueueProvider }));
vi.mock("@nekusora/db", () => ({ closeDb: mocks.closeDb }));
vi.mock("@nekusora/queue", () => ({
  getQueue: mocks.getQueue,
  closeQueue: mocks.closeQueue,
}));
vi.mock("@nekusora/core/worker/definitions", () => ({ WORKER_DEFINITIONS: [] }));
vi.mock("@nekusora/core/worker/runtime", () => ({ createWorkerRuntime: mocks.createWorkerRuntime }));
vi.mock("./health", () => ({
  getWorkerHealthOptions: () => ({ host: "127.0.0.1", port: 4001 }),
  startHealthServer: mocks.startHealthServer,
}));

import { startWorker } from "./main";

beforeEach(() => {
  mocks.calls = [];
  mocks.validateEnv.mockReset().mockImplementation(() => { mocks.calls.push("env"); });
  mocks.bootstrapDatabase.mockReset().mockImplementation(async () => { mocks.calls.push("db.start"); });
  mocks.configureQueueProvider.mockReset().mockImplementation(() => { mocks.calls.push("queue.configure"); });
  mocks.getQueue.mockReset().mockImplementation(async () => {
    mocks.calls.push("queue.get");
    return {};
  });
  mocks.closeQueue.mockReset().mockResolvedValue(undefined);
  mocks.closeDb.mockReset().mockResolvedValue(undefined);
  mocks.startHealthServer.mockReset().mockImplementation(async () => {
    mocks.calls.push("health.start");
    return { setState: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  });
  mocks.createWorkerRuntime.mockReset().mockImplementation(() => ({
    start: vi.fn(async () => { mocks.calls.push("runtime.start"); }),
  }));
});

describe("worker entry", () => {
  it("按进程边界顺序启动", async () => {
    await startWorker();

    expect(mocks.calls).toEqual([
      "env",
      "queue.configure",
      "health.start",
      "db.start",
      "queue.get",
      "runtime.start",
    ]);
    expect(mocks.configureQueueProvider).toHaveBeenCalledWith(mocks.getQueue);
    expect(mocks.bootstrapDatabase).toHaveBeenCalledWith({ seedAdmin: false });
  });

  it("环境校验失败时不加载进程资源", async () => {
    const error = new Error("invalid env");
    mocks.validateEnv.mockImplementation(() => { throw error; });

    await expect(startWorker()).rejects.toBe(error);

    expect(mocks.startHealthServer).not.toHaveBeenCalled();
    expect(mocks.bootstrapDatabase).not.toHaveBeenCalled();
  });
});
