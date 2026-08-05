import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installGlobalErrorGuards: vi.fn(),
  validateEnv: vi.fn(),
  bootstrapDatabase: vi.fn(),
}));

vi.mock("@/lib/infra/process-guards", () => ({
  installGlobalErrorGuards: mocks.installGlobalErrorGuards,
}));
vi.mock("@/lib/infra/env", () => ({ validateEnv: mocks.validateEnv }));
vi.mock("@/lib/infra/db/bootstrap", () => ({
  bootstrapDatabase: mocks.bootstrapDatabase,
}));

import { register } from "./instrumentation";

const originalNextRuntime = process.env.NEXT_RUNTIME;

describe("instrumentation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNextRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalNextRuntime;
  });

  it("Node 启动先安装守卫和校验环境，再初始化数据库", async () => {
    const calls: string[] = [];
    mocks.installGlobalErrorGuards.mockImplementation(() => calls.push("guards"));
    mocks.validateEnv.mockImplementation(() => calls.push("validate"));
    mocks.bootstrapDatabase.mockImplementation(async () => {
      calls.push("bootstrap");
    });

    await register();

    expect(calls).toEqual(["guards", "validate", "bootstrap"]);
  });

  it("Edge runtime 不加载 Node 初始化模块", async () => {
    process.env.NEXT_RUNTIME = "edge";

    await register();

    expect(mocks.installGlobalErrorGuards).not.toHaveBeenCalled();
    expect(mocks.validateEnv).not.toHaveBeenCalled();
    expect(mocks.bootstrapDatabase).not.toHaveBeenCalled();
  });

  it("环境校验失败时阻断数据库 bootstrap", async () => {
    const validationError = new Error("invalid environment");
    mocks.validateEnv.mockImplementation(() => {
      throw validationError;
    });

    await expect(register()).rejects.toBe(validationError);

    expect(mocks.installGlobalErrorGuards).toHaveBeenCalledOnce();
    expect(mocks.bootstrapDatabase).not.toHaveBeenCalled();
  });
});
