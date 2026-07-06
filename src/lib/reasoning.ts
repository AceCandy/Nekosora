/**
 * 推理(reasoning/thinking)级别 → 供应商 providerOptions 翻译。
 *
 * 统一暴露四档 off/low/medium/high(per-model thinkingLevelMap 可覆盖),
 * 在 stream 层按 route.protocol 翻译为 AI SDK v5 streamText 的 providerOptions。
 *
 * 借鉴 pi(earendil-works/pi)的 per-model 元数据驱动思路;不照搬其 thinkingFormat
 * 编码——本项目用 AI SDK providerOptions 已覆盖官方 openai/anthropic/google 三家。
 */
import type {
  ProviderProtocol,
  ModelCapabilities,
  ReasoningLevel,
  ThinkingLevel,
} from "@/db/types";

/** 各 protocol 的默认级别映射(模型未配 thinkingLevelMap 时回退)。 */
const DEFAULT_MAP: Record<ProviderProtocol, Partial<Record<ThinkingLevel, string>>> = {
  openai: { low: "low", medium: "medium", high: "high" },
  anthropic: { low: "4096", medium: "16384", high: "32768" },
  gemini: { low: "2048", medium: "8192", high: "24576" },
  // openai-compatible 无默认:必须 per-model 配 thinkingLevelMap 才下发。
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
 * 返回 undefined = 不启用推理(off / 该档不支持 / 不可映射),上游请求与普通对话一致。
 */
export function buildReasoningProviderOptions(
  protocol: ProviderProtocol,
  capabilities: ModelCapabilities | undefined,
  level: ReasoningLevel | undefined,
): Record<string, unknown> | undefined {
  if (!level || level === "off") return undefined;
  const v = resolveLevelValue(protocol, capabilities, level);
  if (!v) return undefined; // 该档不支持 → 静默忽略

  switch (protocol) {
    case "openai":
    case "openai-compatible":
      // openai 官方:reasoningEffort。openai-compatible:仅当 per-model 配了 map 才到这里
      // (DEFAULT_MAP 无值),走 openai namespace 尝试;若 AI SDK compatible provider 不认,
      // 上游忽略,不报错(符合 D2)。
      return { openai: { reasoningEffort: v } };
    case "anthropic": {
      const budget = Number(v);
      if (!Number.isFinite(budget) || budget <= 0) return undefined;
      return { anthropic: { thinking: { type: "enabled", budget_tokens: budget } } };
    }
    case "gemini": {
      const budget = Number(v);
      if (!Number.isFinite(budget) || budget <= 0) return undefined;
      return { google: { thinkingConfig: { thinkingBudget: budget } } };
    }
    default:
      return undefined;
  }
}

/** 网关 OpenAI 标准 reasoning_effort → 内部统一级别。无法映射返回 undefined(等价 off)。 */
export function resolveReasoningLevel(effort: unknown): ReasoningLevel | undefined {
  if (typeof effort !== "string") return undefined;
  switch (effort) {
    case "low":
    case "medium":
    case "high":
      return effort;
    // minimal/xhigh 在 MVP 四档外,就近归并。
    case "minimal":
      return "low";
    case "xhigh":
      return "high";
    default:
      return undefined;
  }
}
