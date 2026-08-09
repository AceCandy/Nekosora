import { describe, expect, it } from "vitest";
import { routeApiFormatForModel } from "@/db/types";

describe("routeApiFormatForModel", () => {
  it.each([
    ["openai", "openai-chat"],
    ["openai-compatible", "openai-chat"],
    ["anthropic", "anthropic-messages"],
    ["gemini", "gemini-generate-content"],
  ] as const)("%s chat route 使用兼容默认格式", (protocol, expected) => {
    expect(routeApiFormatForModel(undefined, protocol, "chat")).toBe(expected);
  });

  it("允许 chat route 显式选择其他聊天格式", () => {
    expect(routeApiFormatForModel("openai-responses", "openai", "chat"))
      .toBe("openai-responses");
  });

  it("媒体模型只允许 Provider 对应的媒体格式", () => {
    expect(routeApiFormatForModel(undefined, "openai-images", "image"))
      .toBe("openai-images");
    expect(() => routeApiFormatForModel("openai-chat", "openai-images", "image"))
      .toThrow("上游 API 格式与模型类型不匹配");
  });
});
