/**
 * 推理(reasoning/thinking)级别 → 供应商 providerOptions 翻译。
 *
 * 统一暴露 pi 的完整档位 off/minimal/low/medium/high/xhigh/max,
 * 在 stream 层按 route.protocol 翻译为 AI SDK v5 streamText 的 providerOptions。
 *
 * 按模型目录的 thinkingFormat 编码官方协议与 OpenAI-compatible 扩展参数。
 */
import type {
  ProviderProtocol,
  ModelCapabilities,
  ReasoningLevel,
  ThinkingLevel,
} from "@/db/types";

const LEVELS: ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function getSupportedReasoningLevels(capabilities?: ModelCapabilities): ReasoningLevel[] {
  if (!capabilities?.reasoning) return [];
  if (capabilities.thinkingFormat === "fixed") {
    return LEVELS.filter((level) => {
      const mapped = capabilities.thinkingLevelMap?.[level];
      return level !== "off" && typeof mapped === "string" && mapped.length > 0;
    });
  }
  return LEVELS.filter((level) => {
    const mapped = capabilities.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export function getDefaultReasoningLevel(capabilities?: ModelCapabilities): ReasoningLevel {
  return getSupportedReasoningLevels(capabilities)[0] ?? "off";
}

export function clampReasoningLevel(
  capabilities: ModelCapabilities | undefined,
  level: ReasoningLevel,
): ReasoningLevel {
  const supported = getSupportedReasoningLevels(capabilities);
  if (supported.includes(level)) return level;
  const requested = LEVELS.indexOf(level);
  for (let i = requested; i < LEVELS.length; i += 1) {
    if (supported.includes(LEVELS[i])) return LEVELS[i];
  }
  for (let i = requested - 1; i >= 0; i -= 1) {
    if (supported.includes(LEVELS[i])) return LEVELS[i];
  }
  return "off";
}

export function resolveReasoningForModel(
  capabilities: ModelCapabilities | undefined,
  modelId: string,
  stored: Readonly<Record<string, string>> | undefined,
): ReasoningLevel {
  const value = stored?.[modelId];
  const requested = LEVELS.includes(value as ReasoningLevel)
    ? (value as ReasoningLevel)
    : getDefaultReasoningLevel(capabilities);
  return clampReasoningLevel(capabilities, requested);
}

function mappedLevel(capabilities: ModelCapabilities, level: ReasoningLevel): string | undefined {
  const mapped = capabilities.thinkingLevelMap?.[level];
  if (mapped === null) return undefined;
  if (mapped !== undefined) return mapped;
  return level === "off" ? "none" : level;
}

/** 按模型目录声明的官方格式修改 OpenAI-compatible 请求体。 */
export function applyReasoningToCompatibleBody(
  body: Record<string, unknown>,
  capabilities: ModelCapabilities | undefined,
  requested: ReasoningLevel | undefined,
): Record<string, unknown> {
  if (!capabilities?.reasoning || !requested) return body;
  if (!capabilities.thinkingFormat) return body;
  const level = clampReasoningLevel(capabilities, requested);
  const enabled = level !== "off";
  const effort = mappedLevel(capabilities, level);
  switch (capabilities.thinkingFormat) {
    case "fixed":
    case "anthropic":
    case "anthropic-adaptive":
    case "google":
      return body;
    case "zai":
      return {
        ...body,
        thinking: enabled ? { type: "enabled", clear_thinking: false } : { type: "disabled" },
        ...(enabled && effort && capabilities.reasoningEffort ? { reasoning_effort: effort } : {}),
      };
    case "qwen":
      return { ...body, enable_thinking: enabled };
    case "qwen-chat-template":
      return { ...body, chat_template_kwargs: { enable_thinking: enabled, preserve_thinking: true } };
    case "agnes":
      return { ...body, chat_template_kwargs: { enable_thinking: enabled } };
    case "deepseek":
      return {
        ...body,
        thinking: { type: enabled ? "enabled" : "disabled" },
        ...(enabled && effort && capabilities.reasoningEffort ? { reasoning_effort: effort } : {}),
      };
    case "openrouter":
      return { ...body, reasoning: { effort: effort ?? (enabled ? level : "none") } };
    case "together":
      return {
        ...body,
        reasoning: { enabled },
        ...(enabled && effort && capabilities.reasoningEffort ? { reasoning_effort: effort } : {}),
      };
    case "string-thinking":
      return { ...body, thinking: effort ?? (enabled ? level : "none") };
    case "ant-ling":
      return enabled && effort ? { ...body, reasoning: { effort } } : body;
    case "openai":
      return effort ? { ...body, reasoning_effort: effort } : body;
  }
}

/** 各 protocol 的默认级别映射(模型未配 thinkingLevelMap 时回退)。 */
const DEFAULT_MAP: Record<ProviderProtocol, Partial<Record<ThinkingLevel, string>>> = {
  openai: { minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
  anthropic: { minimal: "1024", low: "2048", medium: "8192", high: "16384" },
  gemini: { minimal: "128", low: "2048", medium: "8192", high: "24576" },
  // OpenAI-compatible 由 applyReasoningToCompatibleBody 按 thinkingFormat 编码。
  "openai-compatible": {},
  // 非 chat 协议族不参与推理。
  "openai-images": {},
  "openai-audio-stt": {},
  "openai-audio-tts": {},
};

/** 取某级别的供应商值:per-model map 优先(null=不支持),否则回退 protocol 默认。 */
function resolveLevelValue(
  protocol: ProviderProtocol,
  capabilities: ModelCapabilities | undefined,
  level: ThinkingLevel,
): string | undefined {
  const perModel = capabilities?.thinkingLevelMap?.[level];
  if (perModel !== undefined) return perModel ?? undefined;
  return DEFAULT_MAP[protocol]?.[level];
}

/**
 * 把统一推理级别翻译为 AI SDK v5 streamText 的 providerOptions。
 * 返回 undefined = 固定推理、非推理模型或不可映射;OpenAI-compatible 走请求体转换。
 */
export function buildReasoningProviderOptions(
  protocol: ProviderProtocol,
  capabilities: ModelCapabilities | undefined,
  level: ReasoningLevel | undefined,
): Record<string, unknown> | undefined {
  if (!level || !capabilities?.reasoning) return undefined;
  const clamped = clampReasoningLevel(capabilities, level);
  if (capabilities.thinkingFormat === "fixed") return undefined;
  if (clamped === "off") {
    const offValue = capabilities.thinkingLevelMap?.off;
    if (protocol === "openai" && typeof offValue === "string") {
      return { openai: { reasoningEffort: offValue } };
    }
    if (protocol === "anthropic") {
      return { anthropic: { thinking: { type: "disabled" } } };
    }
    if (protocol === "gemini") {
      return { google: { thinkingConfig: { thinkingBudget: 0 } } };
    }
    return undefined;
  }
  if (protocol === "anthropic" && capabilities.thinkingFormat === "anthropic-adaptive") {
    const mapped = capabilities.thinkingLevelMap?.[clamped];
    const effort = typeof mapped === "string"
      ? mapped
      : clamped === "minimal" || clamped === "low"
        ? "low"
        : clamped;
    return { anthropic: { thinking: { type: "adaptive" }, effort } };
  }
  const v = resolveLevelValue(protocol, capabilities, clamped);
  if (!v) return undefined; // 该档不支持 → 静默忽略

  switch (protocol) {
    case "openai":
    case "openai-compatible":
      return { openai: { reasoningEffort: v } };
    case "anthropic": {
      const budget = Number(v);
      if (!Number.isFinite(budget) || budget <= 0) return undefined;
      return { anthropic: { thinking: { type: "enabled", budgetTokens: budget } } };
    }
    case "gemini": {
      const budget = Number(v);
      if (Number.isFinite(budget) && budget > 0) {
        return { google: { thinkingConfig: { thinkingBudget: budget } } };
      }
      const thinkingLevel = v.toLowerCase();
      return ["minimal", "low", "medium", "high"].includes(thinkingLevel)
        ? { google: { thinkingConfig: { thinkingLevel } } }
        : undefined;
    }
    default:
      return undefined;
  }
}
