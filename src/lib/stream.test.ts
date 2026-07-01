import { describe, it, expect } from "vitest";
import { isFailoverableError, isKeyAuthError, separateSystem } from "@/lib/stream";
import type { IRRequest } from "@/lib/providers/types";

describe("isFailoverableError", () => {
  it("确定性错误不转移:model_not_found", () => {
    expect(isFailoverableError(new Error("model_not_found: gpt-5"))).toBe(false);
  });

  it("确定性错误不转移:invalid_request", () => {
    expect(isFailoverableError(new Error("invalid_request_error"))).toBe(false);
  });

  it("确定性错误不转移:context length", () => {
    expect(isFailoverableError(new Error("This model maximum context length is 8192"))).toBe(false);
  });

  it("连接/超时类错误应转移", () => {
    expect(isFailoverableError(new Error("connect ETIMEDOUT"))).toBe(true);
  });

  it("5xx 类错误应转移", () => {
    expect(isFailoverableError(new Error("502 Bad Gateway"))).toBe(true);
  });

  it("限流类错误应转移", () => {
    expect(isFailoverableError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("非 Error 值也能处理(字符串)", () => {
    expect(isFailoverableError("some connection error")).toBe(true);
    expect(isFailoverableError("invalid_request")).toBe(false);
  });
});

describe("isKeyAuthError", () => {
  it("识别 invalid_api_key", () => {
    expect(isKeyAuthError(new Error("invalid_api_key provided"))).toBe(true);
  });

  it("识别 authentication 类", () => {
    expect(isKeyAuthError(new Error("Authentication failed"))).toBe(true);
  });

  it("识别 incorrect api key", () => {
    expect(isKeyAuthError(new Error("Incorrect API key provided"))).toBe(true);
  });

  it("识别 401 / 403", () => {
    expect(isKeyAuthError(new Error("401 Unauthorized"))).toBe(true);
    expect(isKeyAuthError(new Error("403 Forbidden"))).toBe(true);
  });

  it("非鉴权类错误返回 false", () => {
    expect(isKeyAuthError(new Error("connect ETIMEDOUT"))).toBe(false);
    expect(isKeyAuthError(new Error("500 internal error"))).toBe(false);
  });
});

describe("separateSystem", () => {
  it("抽出 system 消息并从对话中移除", () => {
    const request: IRRequest = {
      model: "gpt-4",
      messages: [
        { role: "system", content: "你是助手" },
        { role: "user", content: "你好" },
      ],
    };
    const { system, messages } = separateSystem(request);
    expect(system).toBe("你是助手");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("多条 system 按顺序用 \\n\\n 拼接", () => {
    const request: IRRequest = {
      model: "gpt-4",
      messages: [
        { role: "system", content: "规则一" },
        { role: "system", content: "规则二" },
        { role: "user", content: "问题" },
      ],
    };
    const { system, messages } = separateSystem(request);
    expect(system).toBe("规则一\n\n规则二");
    expect(messages).toHaveLength(1);
  });

  it("无 system 消息时 system 为 undefined", () => {
    const request: IRRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "你好" }],
    };
    const { system, messages } = separateSystem(request);
    expect(system).toBeUndefined();
    expect(messages).toHaveLength(1);
  });

  it("对话消息为空时抛错(从源头杜绝上游 400)", () => {
    const request: IRRequest = {
      model: "gpt-4",
      messages: [{ role: "system", content: "只有 system" }],
    };
    expect(() => separateSystem(request)).toThrow("消息无效");
  });
});
