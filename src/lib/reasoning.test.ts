import { describe, expect, it } from "vitest";
import type { ModelCapabilities } from "@/db/types";
import {
  applyReasoningToCompatibleBody,
  buildReasoningProviderOptions,
  clampReasoningLevel,
  getDefaultReasoningLevel,
  getSupportedReasoningLevels,
  resolveReasoningForModel,
} from "./reasoning";

describe("model-driven reasoning levels", () => {
  it("follows pi defaults and only exposes explicitly mapped extended levels", () => {
    const caps: ModelCapabilities = { reasoning: true };
    expect(getSupportedReasoningLevels(caps)).toEqual(["off", "minimal", "low", "medium", "high"]);
    expect(getDefaultReasoningLevel(caps)).toBe("off");
  });

  it("uses the lowest supported level when thinking cannot be disabled", () => {
    const caps: ModelCapabilities = {
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: "LOW", medium: null, high: "HIGH" },
    };
    expect(getSupportedReasoningLevels(caps)).toEqual(["low", "high"]);
    expect(getDefaultReasoningLevel(caps)).toBe("low");
    expect(clampReasoningLevel(caps, "medium")).toBe("high");
    expect(clampReasoningLevel(caps, "minimal")).toBe("low");
  });

  it("keeps fixed reasoning on its sole level", () => {
    const caps: ModelCapabilities = {
      reasoning: true,
      thinkingFormat: "fixed",
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "default", xhigh: null, max: null },
    };
    expect(getSupportedReasoningLevels(caps)).toEqual(["high"]);
    expect(clampReasoningLevel(caps, "off")).toBe("high");
    expect(applyReasoningToCompatibleBody({ model: "composer-2.5" }, caps, "high")).toEqual({ model: "composer-2.5" });
  });

  it("exposes Agnes thinking as an off/high toggle", () => {
    const caps: ModelCapabilities = {
      reasoning: true,
      thinkingFormat: "agnes",
      thinkingLevelMap: { minimal: null, low: null, medium: null, high: "2048", xhigh: null, max: null },
    };
    expect(getSupportedReasoningLevels(caps)).toEqual(["off", "high"]);
    expect(buildReasoningProviderOptions("anthropic", caps, "high"))
      .toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } });
  });

  it("restores each model's own level and clamps stale values", () => {
    const caps: ModelCapabilities = {
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: "LOW", medium: null, high: "HIGH" },
    };
    const stored = { "model-a": "high", "model-b": "medium" } as const;
    expect(resolveReasoningForModel(caps, "model-a", stored)).toBe("high");
    expect(resolveReasoningForModel(caps, "model-b", stored)).toBe("high");
    expect(resolveReasoningForModel(caps, "model-c", stored)).toBe("low");
  });
});

describe("OpenAI-compatible reasoning body formats", () => {
  const body = { model: "test" };

  it("encodes OpenAI and OpenRouter effort", () => {
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "openai" }, "high"))
      .toEqual({ model: "test", reasoning_effort: "high" });
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "openrouter" }, "low"))
      .toEqual({ model: "test", reasoning: { effort: "low" } });
  });

  it("encodes zai, qwen, and chat-template switches", () => {
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "zai" }, "off"))
      .toEqual({ model: "test", thinking: { type: "disabled" } });
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "qwen" }, "medium"))
      .toEqual({ model: "test", enable_thinking: true });
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "qwen-chat-template" }, "off"))
      .toEqual({ model: "test", chat_template_kwargs: { enable_thinking: false, preserve_thinking: true } });
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "agnes" }, "high"))
      .toEqual({ model: "test", chat_template_kwargs: { enable_thinking: true } });
  });

  it("encodes deepseek and string thinking with mapped values", () => {
    const deepseek: ModelCapabilities = { reasoning: true, reasoningEffort: true, thinkingFormat: "deepseek", thinkingLevelMap: { high: "max" } };
    expect(applyReasoningToCompatibleBody(body, deepseek, "high"))
      .toEqual({ model: "test", thinking: { type: "enabled" }, reasoning_effort: "max" });
    expect(applyReasoningToCompatibleBody(body, { reasoning: true, thinkingFormat: "string-thinking" }, "off"))
      .toEqual({ model: "test", thinking: "none" });
  });

  it("does not send reasoning_effort to toggle-only compatible models", () => {
    expect(applyReasoningToCompatibleBody(
      body,
      { reasoning: true, thinkingFormat: "zai", thinkingLevelMap: { high: "high" } },
      "high",
    )).toEqual({ model: "test", thinking: { type: "enabled", clear_thinking: false } });
  });
});

describe("official provider reasoning options", () => {
  it("sends an explicit OpenAI none value when the catalog maps off", () => {
    expect(buildReasoningProviderOptions(
      "openai",
      { reasoning: true, thinkingFormat: "openai", thinkingLevelMap: { off: "none" } },
      "off",
    )).toEqual({ openai: { reasoningEffort: "none" } });
  });

  it("uses adaptive thinking and effort for current Claude models", () => {
    expect(buildReasoningProviderOptions(
      "anthropic",
      { reasoning: true, thinkingFormat: "anthropic-adaptive", thinkingLevelMap: { xhigh: "xhigh" } },
      "xhigh",
    )).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort: "xhigh" } });
  });

  it("maps default adaptive Claude levels to effort strings", () => {
    expect(buildReasoningProviderOptions(
      "anthropic",
      { reasoning: true, thinkingFormat: "anthropic-adaptive" },
      "minimal",
    )).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort: "low" } });
  });

  it("uses the AI SDK budgetTokens key for budget-based Anthropic models", () => {
    expect(buildReasoningProviderOptions(
      "anthropic",
      { reasoning: true, thinkingFormat: "anthropic" },
      "low",
    )).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } });
  });

  it("uses Gemini thinkingLevel when the model maps named levels", () => {
    expect(buildReasoningProviderOptions(
      "gemini",
      { reasoning: true, thinkingFormat: "google", thinkingLevelMap: { off: null, low: "LOW" } },
      "low",
    )).toEqual({ google: { thinkingConfig: { thinkingLevel: "low" } } });
  });

  it("explicitly disables budget-based Gemini reasoning", () => {
    expect(buildReasoningProviderOptions(
      "gemini",
      { reasoning: true, thinkingFormat: "google" },
      "off",
    )).toEqual({ google: { thinkingConfig: { thinkingBudget: 0 } } });
  });
});
