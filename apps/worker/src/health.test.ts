import { afterEach, describe, expect, it } from "vitest";
import { getWorkerHealthOptions, startHealthServer } from "./health";

const originalPort = process.env.WORKER_HEALTH_PORT;

afterEach(() => {
  if (originalPort === undefined) delete process.env.WORKER_HEALTH_PORT;
  else process.env.WORKER_HEALTH_PORT = originalPort;
});

describe("worker health", () => {
  it("readiness 随状态变化，drain 期间 liveness 保持可用", async () => {
    const health = await startHealthServer({ host: "127.0.0.1", port: 0 });
    const url = (path: string) => `http://127.0.0.1:${health.port}${path}`;
    try {
      expect((await fetch(url("/healthz/ready"))).status).toBe(503);
      health.setState("ready");
      expect((await fetch(url("/healthz/ready"))).status).toBe(200);
      health.setState("stopping");
      expect((await fetch(url("/healthz/ready"))).status).toBe(503);
      expect((await fetch(url("/healthz"))).status).toBe(200);
      expect((await fetch(url("/unknown"))).status).toBe(404);
    } finally {
      await health.close();
    }
  });

  it("拒绝非法健康端口", () => {
    process.env.WORKER_HEALTH_PORT = "0";
    expect(() => getWorkerHealthOptions()).toThrow("WORKER_HEALTH_PORT 非法");
  });
});
