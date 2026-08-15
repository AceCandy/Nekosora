import { describe, expect, it } from "vitest";
import {
  getMainstreamModelFamily,
  MAINSTREAM_MODEL_FAMILIES,
} from "./mainstream-models";

describe("mainstream model policy", () => {
  it.each([
    ["openai", "gpt-5.6-luna", "gpt"],
    ["anthropic", "claude-sonnet-5", "claude"],
    ["google", "gemini-3.7-flash", "gemini"],
    ["zai", "glm-5.3", "glm"],
    ["minimax", "MiniMax-M3", "minimax"],
    ["moonshotai", "kimi-k3", "kimi"],
    ["xiaomi", "mimo-v2.5-pro", "mimo"],
    ["xai", "grok-4.6", "grok"],
    ["qwen-token-plan", "qwen3.8-max", "qwen"],
    ["deepseek", "deepseek-v4-pro", "deepseek"],
  ])("识别官方主 Provider: %s/%s", (provider, modelId, family) => {
    expect(getMainstreamModelFamily(provider, modelId)?.family).toBe(family);
  });

  it("收录 preview", () => {
    expect(getMainstreamModelFamily("google", "gemini-3.1-pro-preview")?.family)
      .toBe("gemini");
  });

  it.each([
    ["google", "gemini-3.1-flash-live-preview"],
    ["google", "gemini-3.1-flash-lite-image"],
    ["google", "gemini-3.1-pro-preview-customtools"],
    ["google", "gemini-2.5-computer-use-preview-10-2025"],
    ["zai", "glm-5.2-highspeed"],
    ["google", "gemini-robotics-er-1.6-preview"],
    ["openai", "gpt-realtime-2.1"],
    ["openai", "gpt-4o-2024-11-20"],
    ["anthropic", "claude-haiku-4-5-20251001"],
    ["google", "gemini-3-pro-preview-04-2026"],
    ["google", "gemini-flash-latest"],
  ])("排除专项、日期快照和 latest 别名: %s/%s", (provider, modelId) => {
    expect(getMainstreamModelFamily(provider, modelId)).toBeNull();
  });

  it.each([
    ["openrouter", "google/gemini-3.7-flash"],
    ["google-vertex", "gemini-3.7-flash"],
    ["minimax-cn", "MiniMax-M3"],
    ["openai-codex", "gpt-5.6-luna"],
    ["qwen-token-plan", "deepseek-v4-pro"],
  ])("排除聚合、地区、次级 Provider 和混合目录中的其他家族: %s/%s", (
    provider,
    modelId,
  ) => {
    expect(getMainstreamModelFamily(provider, modelId)).toBeNull();
  });

  it("家族配置只有一个表驱动入口", () => {
    expect(MAINSTREAM_MODEL_FAMILIES.map(({ family }) => family)).toEqual([
      "gpt", "claude", "gemini", "glm", "minimax",
      "kimi", "mimo", "grok", "qwen", "deepseek",
    ]);
  });
});
