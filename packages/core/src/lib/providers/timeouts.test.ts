import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_TIMEOUT_LIMITS,
  ProviderTimeoutError,
  createProviderFetch,
  createProviderTimeoutScope,
  parseProviderTimeoutFormData,
  resolveProviderTimeouts,
} from "./timeouts";

describe("provider timeout policy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("为空值应用系统默认值", () => {
    expect(resolveProviderTimeouts({})).toEqual({
      connectTimeoutMs: 60_000,
      readTimeoutMs: 900_000,
      streamIdleTimeoutMs: 120_000,
    });
  });

  it("保留范围内的显式毫秒值", () => {
    expect(resolveProviderTimeouts({
      connectTimeoutMs: 1_250,
      readTimeoutMs: 10_000,
      streamIdleTimeoutMs: 900_000,
    })).toEqual({
      connectTimeoutMs: 1_250,
      readTimeoutMs: 10_000,
      streamIdleTimeoutMs: 900_000,
    });
  });

  it("把表单秒值无损转换为 nullable 毫秒值", () => {
    const formData = new FormData();
    formData.set("connectTimeoutSeconds", "1.234");
    formData.set("readTimeoutSeconds", "");
    formData.set("streamIdleTimeoutSeconds", "900");

    expect(parseProviderTimeoutFormData(formData)).toEqual({
      connectTimeoutMs: 1_234,
      readTimeoutMs: null,
      streamIdleTimeoutMs: 900_000,
    });
  });

  it.each([
    ["connectTimeoutSeconds", "0"],
    ["connectTimeoutSeconds", "0.999"],
    ["connectTimeoutSeconds", "300.001"],
    ["readTimeoutSeconds", "9.999"],
    ["readTimeoutSeconds", "3600.001"],
    ["streamIdleTimeoutSeconds", "4.999"],
    ["streamIdleTimeoutSeconds", "900.001"],
    ["connectTimeoutSeconds", "1.0001"],
    ["connectTimeoutSeconds", "Infinity"],
  ])("拒绝非法秒值 %s=%s", (field, value) => {
    const formData = new FormData();
    formData.set("connectTimeoutSeconds", "60");
    formData.set("readTimeoutSeconds", "900");
    formData.set("streamIdleTimeoutSeconds", "120");
    formData.set(field, value);

    expect(() => parseProviderTimeoutFormData(formData)).toThrow(/超时/);
  });

  it("signal scope 保留最先发生的 caller abort", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const callerReason = new DOMException("client closed", "AbortError");
    const scope = createProviderTimeoutScope(caller.signal, 1_000, "read");

    caller.abort(callerReason);
    vi.advanceTimersByTime(1_000);

    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBe(callerReason);
    scope.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("signal scope 到期后产生可识别的 Provider timeout", () => {
    vi.useFakeTimers();
    const scope = createProviderTimeoutScope(undefined, 1_000, "read");

    vi.advanceTimersByTime(1_000);

    expect(scope.signal.reason).toMatchObject({
      name: "ProviderTimeoutError",
      code: "gateway.timeout",
      kind: "read",
      timeoutMs: 1_000,
    });
    scope.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose 清理 parent abort listener", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const scope = createProviderTimeoutScope(caller.signal, 1_000, "read");

    scope.dispose();
    caller.abort(new DOMException("late abort", "AbortError"));

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(scope.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("共享 fetch 在响应头前执行 connect timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const providerFetch = createProviderFetch({ connectTimeoutMs: 1_000 });

    const request = providerFetch("https://example.test/v1/models");
    const assertion = expect(request).rejects.toBeInstanceOf(ProviderTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("收到响应头后清 connect timer，但继续传播上层取消", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let receivedSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      receivedSignal = init?.signal ?? null;
      return new Response("ok");
    });
    const providerFetch = createProviderFetch({
      connectTimeoutMs: PROVIDER_TIMEOUT_LIMITS.connectTimeoutMs.defaultMs,
      userAgent: "Nekusora/Test",
    });

    await providerFetch("https://example.test/v1/models", { signal: caller.signal });

    expect(vi.getTimerCount()).toBe(0);
    expect(receivedSignal?.aborted).toBe(false);
    caller.abort();
    expect(receivedSignal?.aborted).toBe(true);
  });
});
