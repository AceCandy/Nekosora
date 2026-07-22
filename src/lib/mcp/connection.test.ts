import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectMcpClient,
  withConnectionTimeout,
} from "@/lib/mcp/connection";

describe("MCP connection lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("超时后中止连接并关闭 transport", async () => {
    vi.useFakeTimers();
    let connectSignal: AbortSignal | undefined;
    const client = {
      connect: vi.fn((_: unknown, options?: { signal?: AbortSignal }) => {
        connectSignal = options?.signal;
        return new Promise<void>(() => {});
      }),
    };
    const transport = { close: vi.fn().mockResolvedValue(undefined) };

    const result = withConnectionTimeout(
      (signal) => connectMcpClient(client, transport, signal),
      100,
    );
    const rejection = expect(result).rejects.toThrow("mcp_connect_timeout");

    await vi.advanceTimersByTimeAsync(100);
    await rejection;

    expect(connectSignal?.aborted).toBe(true);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("超时前连接成功时保留 transport 并清理定时器", async () => {
    vi.useFakeTimers();
    let connectSignal: AbortSignal | undefined;
    const client = {
      connect: vi.fn((_: unknown, options?: { signal?: AbortSignal }) => {
        connectSignal = options?.signal;
        return Promise.resolve();
      }),
    };
    const transport = { close: vi.fn().mockResolvedValue(undefined) };

    await expect(
      withConnectionTimeout(
        async (signal) => {
          await connectMcpClient(client, transport, signal);
          return "connected";
        },
        100,
      ),
    ).resolves.toBe("connected");

    expect(connectSignal?.aborted).toBe(false);
    expect(transport.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("连接自身失败时保留原错误且不触发超时关闭", async () => {
    vi.useFakeTimers();
    const connectionError = new Error("mcp_auth_failed");
    const client = {
      connect: vi.fn().mockRejectedValue(connectionError),
    };
    const transport = { close: vi.fn().mockResolvedValue(undefined) };

    await expect(
      withConnectionTimeout(
        (signal) => connectMcpClient(client, transport, signal),
        100,
      ),
    ).rejects.toBe(connectionError);

    expect(transport.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("连接前信号已中止时关闭 transport 且不启动 client", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = { connect: vi.fn().mockResolvedValue(undefined) };
    const transport = { close: vi.fn().mockResolvedValue(undefined) };

    await expect(
      connectMcpClient(client, transport, controller.signal),
    ).rejects.toBe(controller.signal.reason);

    expect(client.connect).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
