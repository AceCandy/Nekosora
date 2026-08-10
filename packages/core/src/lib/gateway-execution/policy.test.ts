import { describe, expect, it } from "vitest";
import { ProviderTimeoutError } from "@/lib/providers/timeouts";
import { classifyGatewayError, isAbortError } from "./policy";

describe("gateway timeout policy", () => {
  it.each([
    new ProviderTimeoutError("connect", 1_000),
    { lastError: new ProviderTimeoutError("read", 10_000) },
    new Error("sdk wrapper", { cause: new DOMException("No chunk received", "TimeoutError") }),
  ])("把直接或嵌套 timeout 稳定映射为 gateway.timeout", (error) => {
    expect(classifyGatewayError(error)).toEqual({
      code: "gateway.timeout",
      message: "上游 Provider 请求超时",
      phase: "network",
      httpStatus: 504,
    });
    expect(isAbortError(error)).toBe(false);
  });

  it("保留客户端 AbortError 语义", () => {
    const error = new DOMException("This operation was aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });
});
