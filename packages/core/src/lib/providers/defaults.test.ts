import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./defaults";

describe("normalizeBaseUrl", () => {
  it.each([
    "https://gateway.example/v1/responses",
    "https://gateway.example/v1/messages/",
    "https://gateway.example/v1/chat/completions?trace=1",
    "https://gateway.example/v1beta/models/demo:generateContent",
    "https://gateway.example/v1beta/models/demo:streamGenerateContent/#fragment",
  ])("拒绝具体生成 endpoint: %s", (baseUrl) => {
    expect(() => normalizeBaseUrl("openai-compatible", baseUrl))
      .toThrow("接口地址必须填写 API 根地址，不能包含具体生成端点");
  });

  it("OpenAI-compatible 纯 host 自动补 /v1", () => {
    expect(normalizeBaseUrl("openai-compatible", " https://gateway.example/ "))
      .toBe("https://gateway.example/v1");
  });

  it.each([
    ["openai-compatible", "https://gateway.example/v1", "https://gateway.example/v1"],
    ["openai-compatible", "https://gateway.example/custom/api/", "https://gateway.example/custom/api"],
    ["anthropic", " https://gateway.example/v1/ ", "https://gateway.example/v1"],
    ["gemini", "https://gateway.example/v1beta", "https://gateway.example/v1beta"],
  ] as const)("%s 保留合法 API 根 %s", (protocol, baseUrl, expected) => {
    expect(normalizeBaseUrl(protocol, baseUrl)).toBe(expected);
  });
});
