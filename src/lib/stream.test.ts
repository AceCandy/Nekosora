import { describe, it, expect } from "vitest";
import { generateText, modelMessageSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  isFailoverableError,
  isKeyAuthError,
  isRetryableForKey,
  separateSystem,
  classifyStreamError,
} from "@/lib/stream";
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

describe("isRetryableForKey", () => {
  // 模拟 AI SDK RetryError:lastError 带 statusCode
  function makeRetryError(statusCode: number, message: string): Error {
    const err = new Error(message);
    (err as Record<string, unknown>).lastError = { statusCode };
    return err;
  }
  // 模拟 AI_APICallError:带 statusCode
  function makeApiError(statusCode: number, message: string): Error {
    const err = new Error(message);
    (err as Record<string, unknown>).statusCode = statusCode;
    return err;
  }

  it("认证类(401/403)换 key", () => {
    expect(isRetryableForKey(new Error("invalid_api_key"))).toBe(true);
    expect(isRetryableForKey(new Error("401 Unauthorized"))).toBe(true);
    expect(isRetryableForKey(new Error("403 Forbidden"))).toBe(true);
  });

  it("限流(429)换 key:直接 AI_APICallError", () => {
    expect(isRetryableForKey(makeApiError(429, "Too Many Requests"))).toBe(true);
  });

  it("限流(429)换 key:RetryError 包 lastError", () => {
    expect(isRetryableForKey(makeRetryError(429, "Failed after retries"))).toBe(true);
  });

  it("5xx 换 key", () => {
    expect(isRetryableForKey(makeApiError(502, "Bad Gateway"))).toBe(true);
    expect(isRetryableForKey(makeApiError(503, "Service Unavailable"))).toBe(true);
  });

  it("连接/超时类换 key", () => {
    expect(isRetryableForKey(new Error("connect ETIMEDOUT"))).toBe(true);
    expect(isRetryableForKey(new Error("fetch failed"))).toBe(true);
  });

  it("确定性错误不换 key:model_not_found", () => {
    expect(isRetryableForKey(new Error("model_not_found: gpt-5"))).toBe(false);
  });

  it("确定性错误不换 key:invalid_request", () => {
    expect(isRetryableForKey(new Error("invalid_request_error"))).toBe(false);
  });

  it("确定性错误不换 key:context length", () => {
    expect(isRetryableForKey(new Error("This model maximum context length is 8192"))).toBe(false);
  });

  it("泛化 400(message 无确定性关键词)仍可换 key,与路由级 isFailoverableError 行为一致", () => {
    // makeApiError(400) 的 message 是 "Bad Request",既非认证也非限流,
    // 不命中 429;isFailoverableError 对 "bad request" 返回 true(只有 model_not_found/
    // invalid_request/context length 才 false)。故 400 泛化错误会换 key。
    expect(isRetryableForKey(makeApiError(400, "Bad Request"))).toBe(true);
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

  it("将远程 URL 和 data URL 图片转换为 AI SDK 文件 part", async () => {
    const remoteUrl = "https://s3.example.com/image.png?signature=test";
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    const request: IRRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述图片" },
            { type: "image_url", image_url: { url: remoteUrl } },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    };

    const { messages } = separateSystem(request);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "描述图片" },
          { type: "file", data: new URL(remoteUrl), mediaType: "image" },
          { type: "file", data: new URL(dataUrl), mediaType: "image" },
        ],
      },
    ]);
    expect(messages.every((message) => modelMessageSchema.safeParse(message).success)).toBe(true);

    const model = new MockLanguageModelV4({
      supportedUrls: { "image/*": [/^https?:\/\//] },
      doGenerate: {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    });

    await generateText({ model, messages });

    expect(model.doGenerateCalls[0].prompt).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "描述图片", providerOptions: undefined },
          {
            type: "file",
            data: { type: "url", url: new URL(remoteUrl) },
            filename: undefined,
            mediaType: "image",
            providerOptions: undefined,
          },
          {
            type: "file",
            data: { type: "data", data: "aGVsbG8=" },
            filename: undefined,
            mediaType: "image/png",
            providerOptions: undefined,
          },
        ],
        providerOptions: undefined,
      },
    ]);
  });

  it("纯文本消息转换后保持不变", () => {
    const request: IRRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "你好" }],
    };

    expect(separateSystem(request).messages).toEqual(request.messages);
  });

  it("对话消息为空时抛错(从源头杜绝上游 400)", () => {
    const request: IRRequest = {
      model: "gpt-4",
      messages: [{ role: "system", content: "只有 system" }],
    };
    expect(() => separateSystem(request)).toThrow("消息无效");
  });
});

describe("classifyStreamError", () => {
  // 模拟 AI SDK RetryError:Error 子类,lastError 是 AI_APICallError(带 statusCode)
  function makeRetryError(statusCode: number, message: string): Error {
    const err = new Error(message);
    (err as Record<string, unknown>).lastError = { statusCode };
    return err;
  }
  // 模拟 AI_APICallError:Error 子类,带 statusCode
  function makeApiError(statusCode: number, message: string): Error {
    const err = new Error(message);
    (err as Record<string, unknown>).statusCode = statusCode;
    return err;
  }

  it("429 RetryError -> rate_limited / 429", () => {
    expect(classifyStreamError(makeRetryError(429, "Failed after 3 attempts: Too Many Requests")))
      .toMatchObject({ statusCode: 429, errorCode: "rate_limited" });
  });

  it("401 AI_APICallError -> auth_error / 401", () => {
    expect(classifyStreamError(makeApiError(401, "Unauthorized")))
      .toMatchObject({ statusCode: 401, errorCode: "auth_error" });
  });

  it("403 -> auth_error / 403", () => {
    expect(classifyStreamError(makeApiError(403, "Forbidden")))
      .toMatchObject({ statusCode: 403, errorCode: "auth_error" });
  });

  it("5xx -> upstream_error", () => {
    expect(classifyStreamError(makeApiError(502, "Bad Gateway")))
      .toMatchObject({ statusCode: 502, errorCode: "upstream_error" });
    expect(classifyStreamError(makeApiError(503, "Service Unavailable")))
      .toMatchObject({ statusCode: 503, errorCode: "upstream_error" });
  });

  it("无 statusCode + 网络关键字 -> network_error", () => {
    expect(classifyStreamError(new Error("connect ETIMEDOUT")))
      .toMatchObject({ errorCode: "network_error" });
  });

  it("无 statusCode + 无网络关键字 -> generation_failed 兜底", () => {
    expect(classifyStreamError(new Error("some unknown error")))
      .toMatchObject({ errorCode: "generation_failed" });
  });

  it("400(非限流/鉴权 4xx)-> generation_failed", () => {
    expect(classifyStreamError(makeApiError(400, "Bad Request")))
      .toMatchObject({ statusCode: 400, errorCode: "generation_failed" });
  });

  it("RetryError 取 lastError.statusCode(err 本身无 statusCode)", () => {
    const err = new Error("retry failed");
    (err as Record<string, unknown>).lastError = { statusCode: 429 };
    expect(classifyStreamError(err)).toMatchObject({ statusCode: 429, errorCode: "rate_limited" });
  });

  it("message 保留原 Error.message", () => {
    expect(classifyStreamError(new Error("Too Many Requests")).message).toBe("Too Many Requests");
  });

  it("脱敏返回消息但仍按原始 statusCode 分类", () => {
    expect(
      classifyStreamError(
        makeApiError(401, "upstream rejected SECRET"),
        ["SECRET"],
      ),
    ).toEqual({
      statusCode: 401,
      errorCode: "auth_error",
      message: "upstream rejected [REDACTED]",
    });
  });
});
