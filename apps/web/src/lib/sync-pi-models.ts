/**
 * pi 模型配置同步的纯逻辑(无 IO/DB)。scripts/sync-pi-models.ts 负责 IO 与迁移生成;
 * 此处函数可单测。
 *
 * 数据源: https://pi.dev/api/models(与 https://pi.dev/models 同源)。
 *
 * 三不变量(最高优先级):
 *   1. 不显示推理强度 ⇒ reasoning !== true
 *   2. 显示但单一强度 ⇒ 开且不可调(levels 恰好 1 个非 off 档)
 *   3. 显示 ⇒ 可调,只显示真实拥有的强度档
 */
import { getSupportedReasoningLevels } from "@/lib/reasoning";
import type { ModelCapabilities, ThinkingFormat, WebSearchFormat } from "@/db/types";

/** pi 模型条目的最小结构(pi.dev/api/models 子集)。 */
export interface PiModel {
  id: string;
  name?: string;
  api?: string;
  compat?: { thinkingFormat?: string; supportsReasoningEffort?: boolean };
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
}

/** model_catalog chat 行的现状(脚本从 DB 读出后传入)。 */
export interface CatalogRow {
  canonicalModelId: string;
  name: string;
  aliases: string[];
  capabilities: ModelCapabilities;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export type PiCatalog = Record<string, Record<string, PiModel>>;

export type SyncRejectionScope = "payload" | "model" | "reasoning" | "vision";
export type SyncRejectionCode =
  | "invalid_payload_root"
  | "invalid_provider_models"
  | "invalid_model"
  | "invalid_model_id"
  | "invalid_reasoning_boolean"
  | "invalid_compat_object"
  | "invalid_map_key"
  | "invalid_map_value"
  | "invalid_map_shape"
  | "invalid_compat_boolean"
  | "invalid_thinking_format"
  | "invalid_input"
  | "invalid_context_window"
  | "invalid_max_tokens"
  | "invalid_reasoning_bundle"
  | "incompatible_reasoning_effort"
  | "reasoning_disabled_extras_ignored"
  | "ambiguous_direct_match";

export interface SyncRejection {
  provider?: string;
  modelKey?: string;
  canonicalModelId?: string;
  scope: SyncRejectionScope;
  code: SyncRejectionCode;
}

export interface PiDecodeResult {
  catalog: PiCatalog;
  rejections: SyncRejection[];
}

export class CatalogSyncInputError extends Error {
  constructor(public readonly code: "invalid_payload_root") {
    super("model catalog sync input rejected");
    this.name = "CatalogSyncInputError";
  }
}

const THINKING_LEVEL_KEYS = new Set([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortRejections(rejections: SyncRejection[]): SyncRejection[] {
  return rejections.sort((left, right) =>
    (left.provider ?? "").localeCompare(right.provider ?? "")
    || (left.modelKey ?? "").localeCompare(right.modelKey ?? "")
    || (left.canonicalModelId ?? "").localeCompare(right.canonicalModelId ?? "")
    || left.scope.localeCompare(right.scope)
    || left.code.localeCompare(right.code));
}

// pi 的 9 个 OpenAI-compatible 改写格式:命中则采用 pi 值。
export const OVERLAP = new Set<string>([
  "openai", "openrouter", "deepseek", "together", "zai",
  "qwen", "qwen-chat-template", "string-thinking", "ant-ling",
]);
// 我们独有、pi 无对应、且有实质作用/产品语义的格式:保留不动。
export const KEEP = new Set<string>(["fixed", "agnes", "anthropic-adaptive"]);
const LEGAL_THINKING_FORMATS = new Set<string>([
  ...OVERLAP,
  ...KEEP,
  "anthropic",
  "google",
]);

const WEB_SEARCH_MODEL_IDS: Record<WebSearchFormat, ReadonlySet<string>> = {
  openai: new Set([
    "gpt-5.5", "gpt-5.5-pro", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra",
  ]),
  anthropic: new Set(["claude-opus-5", "claude-sonnet-5"]),
  google: new Set([
    "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
    "gemini-3-flash-preview", "gemini-3.1-pro-preview",
    "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash",
  ]),
  xai: new Set(["grok-4.5"]),
};

function webSearchFormatFor(matchResult: MatchResult): WebSearchFormat | undefined {
  const { provider, pi } = matchResult;
  if (
    provider === "openai"
    && pi.api === "openai-responses"
    && WEB_SEARCH_MODEL_IDS.openai.has(pi.id)
  ) return "openai";
  if (
    provider === "anthropic"
    && pi.api === "anthropic-messages"
    && WEB_SEARCH_MODEL_IDS.anthropic.has(pi.id)
  ) return "anthropic";
  if (
    provider === "google"
    && pi.api === "google-generative-ai"
    && WEB_SEARCH_MODEL_IDS.google.has(pi.id)
  ) return "google";
  if (
    provider === "xai"
    && pi.api === "openai-responses"
    && WEB_SEARCH_MODEL_IDS.xai.has(pi.id)
  ) return "xai";
  return undefined;
}
// bare 匹配时排除聚合 provider 与区域变体,优先官方主 provider。
export const AGGREGATOR = new Set([
  "opencode", "opencode-go", "openrouter", "azure-openai-responses",
  "cloudflare-ai-gateway", "github-copilot", "google-vertex", "fireworks",
  "groq", "nvidia", "together", "huggingface", "cerebras",
  "cloudflare-workers-ai", "vercel-ai-gateway", "amazon-bedrock",
]);
/** 多命中时的主源优先序(官方厂商在前,聚合商靠后)。 */
export const PROVIDER_RANK = [
  "google", "openai", "anthropic", "zai", "xai", "deepseek",
  "moonshotai", "minimax", "ant-ling", "mistral", "xiaomi",
  // 聚合商:openrouter 常有较完整窗口;huggingface 作模型卡兜底
  "openrouter", "together", "huggingface", "vercel-ai-gateway",
  "groq", "cerebras", "nvidia", "fireworks", "opencode",
  "amazon-bedrock", "cloudflare-workers-ai", "cloudflare-ai-gateway",
];
/** 网关改写格式:可识别,但不应用来覆盖模型官方 thinkingFormat。 */
export const AGGREGATOR_FORMATS = new Set(["openrouter", "together"]);
export const isVariant = (p: string): boolean => /-(cn|ams|sgp)$/.test(p) || p === "zai-coding-cn";

export type MatchKind =
  | "provider-id"
  | "ambiguous-provider-id"
  | "unique-bare-id"
  | "ambiguous-bare-id"
  | "path"
  | "tail";
export type MatchAuthority = "direct" | "reference";
export type MatchReferenceReason =
  | "aggregate_or_variant"
  | "ambiguous_direct_match"
  | "path_match"
  | "tail_match";

export interface MatchResult {
  pi: PiModel;
  provider: string;
  modelKey: string;
  via: string;
  kind: MatchKind;
  authority: MatchAuthority;
  reason?: MatchReferenceReason;
}

export type MatchEvidence = Omit<MatchResult, "pi">;

export interface SyncChange {
  canonicalModelId: string;
  name: string;
  match: MatchEvidence;
  operations: CatalogOperation[];
  nextCapabilities: ModelCapabilities;
}

export interface SyncPlan {
  changes: SyncChange[];
  references: SyncChange[];
  rejections: SyncRejection[];
  matched: number;
  unchanged: number;
  unmatched: {
    generic: string[];
    catalog: string[];
  };
}

export type CatalogOperation =
  | {
    target: "capability";
    action: "set";
    key: keyof ModelCapabilities;
    value: unknown;
  }
  | {
    target: "capability";
    action: "delete";
    key: keyof ModelCapabilities;
  }
  | {
    target: "column";
    action: "set";
    column: "contextWindow" | "maxOutputTokens";
    value: number;
  };

function providerRank(p: string): number {
  const i = PROVIDER_RANK.indexOf(p);
  return i === -1 ? 1000 : i;
}

function modelTail(key: string): string {
  const base = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
  return base.toLowerCase().replace(/:free$/i, "");
}

interface Candidate {
  provider: string;
  modelKey: string;
  pi: PiModel;
}

function isFreeKey(key: string): boolean {
  return key.includes(":free") || key.endsWith("-free");
}

function compareCandidate(a: Candidate, b: Candidate): number {
  const aFree = isFreeKey(a.modelKey);
  const bFree = isFreeKey(b.modelKey);
  if (aFree !== bFree) return aFree ? 1 : -1;
  const aAgg = AGGREGATOR.has(a.provider) || isVariant(a.provider);
  const bAgg = AGGREGATOR.has(b.provider) || isVariant(b.provider);
  if (aAgg !== bAgg) return aAgg ? 1 : -1;
  return providerRank(a.provider) - providerRank(b.provider)
    || a.provider.localeCompare(b.provider)
    || a.modelKey.localeCompare(b.modelKey);
}

function candidateResult(
  candidate: Candidate,
  kind: MatchKind,
  authority: MatchAuthority,
  reason?: MatchReferenceReason,
): MatchResult {
  return {
    ...candidate,
    via: `${candidate.provider}/${candidate.modelKey}`,
    kind,
    authority,
    ...(reason ? { reason } : {}),
  };
}

function allCandidates(PI: PiCatalog): Candidate[] {
  const candidates: Candidate[] = [];
  for (const provider of Object.keys(PI).sort()) {
    for (const modelKey of Object.keys(PI[provider]).sort()) {
      candidates.push({ provider, modelKey, pi: PI[provider][modelKey] });
    }
  }
  return candidates;
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.provider}\0${candidate.modelKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 匹配只负责描述证据强度;只有官方精确 provider/id 或唯一官方 bare id 可写。 */
export function match(
  canon: string,
  aliases: string[],
  PI: PiCatalog,
): MatchResult | null {
  const identifiers = [...new Set([canon, ...aliases].map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const candidates = allCandidates(PI);

  const providerId = uniqueCandidates(identifiers.flatMap((identifier) => {
    const separator = identifier.indexOf("/");
    if (separator <= 0) return [];
    const provider = identifier.slice(0, separator);
    const modelKey = identifier.slice(separator + 1);
    const pi = PI[provider]?.[modelKey];
    return pi ? [{ provider, modelKey, pi }] : [];
  })).sort(compareCandidate);
  const directProviderIds = providerId.filter((candidate) =>
    !AGGREGATOR.has(candidate.provider) && !isVariant(candidate.provider));
  if (directProviderIds.length === 1) {
    return candidateResult(directProviderIds[0], "provider-id", "direct");
  }
  if (directProviderIds.length > 1) {
    return candidateResult(
      directProviderIds[0],
      "ambiguous-provider-id",
      "reference",
      "ambiguous_direct_match",
    );
  }

  const bareIds = identifiers.filter((identifier) => !identifier.includes("/"))
    .map((identifier) => identifier.toLowerCase());
  const bareMatches = uniqueCandidates(candidates.filter((candidate) =>
    bareIds.includes(candidate.modelKey.toLowerCase())
    || bareIds.includes(candidate.pi.id.toLowerCase()))).sort(compareCandidate);
  const officialBareMatches = bareMatches.filter((candidate) =>
    !AGGREGATOR.has(candidate.provider) && !isVariant(candidate.provider));
  if (officialBareMatches.length === 1) {
    return candidateResult(officialBareMatches[0], "unique-bare-id", "direct");
  }
  if (officialBareMatches.length > 1) {
    return candidateResult(
      officialBareMatches[0],
      "ambiguous-bare-id",
      "reference",
      "ambiguous_direct_match",
    );
  }

  if (providerId.length > 0) {
    return candidateResult(providerId[0], "provider-id", "reference", "aggregate_or_variant");
  }
  if (bareMatches.length > 0) {
    const kind = bareMatches.length === 1 ? "unique-bare-id" : "ambiguous-bare-id";
    const reason = bareMatches.length === 1 ? "aggregate_or_variant" : "ambiguous_direct_match";
    return candidateResult(bareMatches[0], kind, "reference", reason);
  }

  const pathMatches = uniqueCandidates(candidates.filter((candidate) =>
    identifiers.some((identifier) => identifier.includes("/") && (
      candidate.modelKey.toLowerCase() === identifier.toLowerCase()
      || candidate.pi.id.toLowerCase() === identifier.toLowerCase()
    )))).sort(compareCandidate);
  if (pathMatches.length > 0) {
    return candidateResult(pathMatches[0], "path", "reference", "path_match");
  }

  const tails = identifiers.map(modelTail);
  const tailMatches = uniqueCandidates(candidates.filter((candidate) =>
    tails.includes(modelTail(candidate.modelKey)) || tails.includes(modelTail(candidate.pi.id))))
    .sort(compareCandidate);
  return tailMatches.length > 0
    ? candidateResult(tailMatches[0], "tail", "reference", "tail_match")
    : null;
}

/** 在外部边界解码 pi.dev/api/models,单模型字段失败不会阻断其余目录。 */
export function decodePiModelsApi(data: unknown): PiDecodeResult {
  if (!isPlainObject(data)) throw new CatalogSyncInputError("invalid_payload_root");

  const out: PiCatalog = {};
  const rejections: SyncRejection[] = [];
  for (const [provider, models] of Object.entries(data)) {
    if (!isPlainObject(models)) {
      rejections.push({ provider, scope: "model", code: "invalid_provider_models" });
      continue;
    }
    const bucket: Record<string, PiModel> = {};
    for (const [modelKey, raw] of Object.entries(models)) {
      if (!isPlainObject(raw)) {
        rejections.push({ provider, modelKey, scope: "model", code: "invalid_model" });
        continue;
      }
      const m = raw;
      if (typeof m.id !== "string" || m.id.trim().length === 0) {
        rejections.push({ provider, modelKey, scope: "model", code: "invalid_model_id" });
        continue;
      }
      const compatRaw = m.compat;
      let compat: PiModel["compat"];
      if (isPlainObject(compatRaw)) {
        compat = {};
        if (
          typeof compatRaw.thinkingFormat === "string"
          && LEGAL_THINKING_FORMATS.has(compatRaw.thinkingFormat)
        ) {
          compat.thinkingFormat = compatRaw.thinkingFormat;
        } else if (compatRaw.thinkingFormat !== undefined) {
          rejections.push({
            provider,
            modelKey,
            scope: "reasoning",
            code: "invalid_thinking_format",
          });
        }
        if (typeof compatRaw.supportsReasoningEffort === "boolean") {
          compat.supportsReasoningEffort = compatRaw.supportsReasoningEffort;
        } else if (compatRaw.supportsReasoningEffort !== undefined) {
          rejections.push({
            provider,
            modelKey,
            scope: "reasoning",
            code: "invalid_compat_boolean",
          });
        }
      } else if (compatRaw !== undefined) {
        rejections.push({
          provider,
          modelKey,
          scope: "reasoning",
          code: "invalid_compat_object",
        });
      }

      let thinkingLevelMap: PiModel["thinkingLevelMap"];
      if (isPlainObject(m.thinkingLevelMap)) {
        const decodedMap: Record<string, string | null> = {};
        let valid = true;
        for (const [key, value] of Object.entries(m.thinkingLevelMap)) {
          if (!THINKING_LEVEL_KEYS.has(key)) {
            valid = false;
            rejections.push({ provider, modelKey, scope: "reasoning", code: "invalid_map_key" });
            continue;
          }
          if (value === null) {
            decodedMap[key] = null;
          } else if (typeof value === "string" && value.trim().length > 0) {
            decodedMap[key] = value.trim();
          } else {
            valid = false;
            rejections.push({ provider, modelKey, scope: "reasoning", code: "invalid_map_value" });
          }
        }
        if (valid) thinkingLevelMap = decodedMap;
      } else if (m.thinkingLevelMap !== undefined) {
        rejections.push({
          provider,
          modelKey,
          scope: "reasoning",
          code: "invalid_map_shape",
        });
      }
      let input: string[] | undefined;
      if (Array.isArray(m.input) && m.input.every((value) => typeof value === "string")) {
        input = m.input;
      } else if (m.input !== undefined) {
        rejections.push({ provider, modelKey, scope: "vision", code: "invalid_input" });
      }
      const reasoning = typeof m.reasoning === "boolean" ? m.reasoning : undefined;
      if (m.reasoning !== undefined && reasoning === undefined) {
        rejections.push({
          provider,
          modelKey,
          scope: "reasoning",
          code: "invalid_reasoning_boolean",
        });
      }
      const contextWindow = typeof m.contextWindow === "number"
        && Number.isSafeInteger(m.contextWindow)
        && m.contextWindow > 0
        ? m.contextWindow
        : undefined;
      if (m.contextWindow !== undefined && contextWindow === undefined) {
        rejections.push({ provider, modelKey, scope: "model", code: "invalid_context_window" });
      }
      const maxTokens = typeof m.maxTokens === "number"
        && Number.isSafeInteger(m.maxTokens)
        && m.maxTokens > 0
        ? m.maxTokens
        : undefined;
      if (m.maxTokens !== undefined && maxTokens === undefined) {
        rejections.push({ provider, modelKey, scope: "model", code: "invalid_max_tokens" });
      }
      bucket[modelKey] = {
        id: m.id,
        name: typeof m.name === "string" ? m.name : undefined,
        api: typeof m.api === "string" ? m.api : undefined,
        compat: compat && Object.keys(compat).length > 0 ? compat : undefined,
        reasoning,
        thinkingLevelMap,
        input,
        contextWindow,
        maxTokens,
      };
    }
    if (Object.keys(bucket).length) out[provider] = bucket;
  }
  return { catalog: out, rejections: sortRejections(rejections) };
}

/** 闸门:reasoning=true 时刷后必须有可显档;fixed 必须恰好一个。 */
export function passesInvariants(cap: ModelCapabilities): boolean {
  if (!cap.reasoning) return true;
  const levels = getSupportedReasoningLevels(cap);
  return cap.thinkingFormat === "fixed"
    ? cap.thinkingLevelMap?.off === null && levels.length === 1
    : levels.length > 0;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJsonValue(value[key])]),
  );
}

/** 递归规范化 JSON,消除对象及嵌套 map 键序造成的误报。 */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value)) ?? "undefined";
}

export function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function capabilityTargetExpression(operations: CatalogOperation[]): string | null {
  const capabilityOperations = operations.filter((operation) => operation.target === "capability");
  if (capabilityOperations.length === 0) return null;

  let expression = '"capabilities"';
  const deletes = capabilityOperations
    .filter((operation) => operation.action === "delete")
    .map((operation) => operation.key)
    .sort();
  for (const key of deletes) expression = `(${expression} - ${sqlLit(key)})`;

  const patch = Object.fromEntries(capabilityOperations
    .filter((operation) => operation.action === "set")
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((operation) => [operation.key, operation.value]));
  if (Object.keys(patch).length > 0) {
    expression = `(${expression} || ${sqlLit(stableJson(patch))}::jsonb)`;
  }
  return expression;
}

function buildCatalogChangeSql(change: SyncChange): string {
  const assignments: string[] = [];
  const predicates: string[] = [];
  const capabilityTarget = capabilityTargetExpression(change.operations);
  if (capabilityTarget) {
    assignments.push(`"capabilities" = ${capabilityTarget}`);
    predicates.push(`"capabilities" IS DISTINCT FROM ${capabilityTarget}`);
  }

  for (const operation of change.operations) {
    if (operation.target !== "column") continue;
    const column = operation.column === "contextWindow" ? "context_window" : "max_output_tokens";
    assignments.push(`"${column}" = ${operation.value}`);
    predicates.push(`"${column}" IS DISTINCT FROM ${operation.value}`);
  }
  assignments.push('"updated_at" = now()');

  return [
    'UPDATE "model_catalog"',
    `SET\n  ${assignments.join(",\n  ")}`,
    `WHERE "canonical_model_id" = ${sqlLit(change.canonicalModelId)}`,
    `  AND (\n    ${predicates.join("\n    OR ")}\n  );`,
  ].join("\n");
}

/** SQL 只消费 planner 已接受的 changes;reference/rejection 无法进入写路径。 */
export function buildCatalogSyncSql(plan: SyncPlan): string[] {
  return plan.changes.map(buildCatalogChangeSql);
}

const REASONING_CAPABILITY_KEYS: Array<keyof ModelCapabilities> = [
  "reasoning",
  "thinkingFormat",
  "thinkingLevelMap",
  "reasoningEffort",
];

const REASONING_EFFORT_FORMATS = new Set<ThinkingFormat>([
  "openai",
  "zai",
  "deepseek",
  "together",
]);

function clearCapabilities(
  capabilities: ModelCapabilities,
  keys: Array<keyof ModelCapabilities>,
): void {
  const target = capabilities as Record<string, unknown>;
  for (const key of keys) delete target[key];
}

function setCapability(
  capabilities: ModelCapabilities,
  key: keyof ModelCapabilities,
  value: unknown,
): void {
  (capabilities as Record<string, unknown>)[key] = value;
}

function validReasoningBundle(capabilities: ModelCapabilities): SyncRejectionCode | null {
  if (!passesInvariants(capabilities)) return "invalid_reasoning_bundle";
  if (
    capabilities.reasoningEffort
    && (!capabilities.thinkingFormat || !REASONING_EFFORT_FORMATS.has(capabilities.thinkingFormat))
  ) {
    return "incompatible_reasoning_effort";
  }
  if (capabilities.thinkingFormat === "fixed" && capabilities.thinkingLevelMap?.off !== null) {
    return "invalid_reasoning_bundle";
  }
  return null;
}

function buildReasoningCandidate(
  current: ModelCapabilities,
  pi: PiModel,
): ModelCapabilities | null {
  const protectedFormat = current.thinkingFormat && KEEP.has(current.thinkingFormat);
  const piFormat = pi.compat?.thinkingFormat;
  const canAdoptPiFormat = !protectedFormat
    && typeof piFormat === "string"
    && OVERLAP.has(piFormat)
    && !AGGREGATOR_FORMATS.has(piFormat);
  const changesFormat = canAdoptPiFormat && piFormat !== current.thinkingFormat;

  if (changesFormat) {
    if (
      pi.thinkingLevelMap === undefined
      || pi.compat?.supportsReasoningEffort === undefined
    ) {
      return null;
    }
    const candidate: ModelCapabilities = { ...current };
    clearCapabilities(candidate, REASONING_CAPABILITY_KEYS);
    candidate.reasoning = true;
    candidate.thinkingFormat = piFormat as ThinkingFormat;
    candidate.thinkingLevelMap = pi.thinkingLevelMap;
    if (pi.compat.supportsReasoningEffort) candidate.reasoningEffort = true;
    return candidate;
  }

  const candidate: ModelCapabilities = { ...current, reasoning: true };
  if (canAdoptPiFormat) candidate.thinkingFormat = piFormat as ThinkingFormat;
  if (canAdoptPiFormat && pi.thinkingLevelMap !== undefined) {
    candidate.thinkingLevelMap = pi.thinkingLevelMap;
  }
  if (!protectedFormat && pi.compat?.supportsReasoningEffort !== undefined) {
    if (pi.compat.supportsReasoningEffort) candidate.reasoningEffort = true;
    else delete candidate.reasoningEffort;
  }
  return candidate;
}

function proposeCapabilities(
  current: ModelCapabilities,
  pi: PiModel,
  matchResult: MatchResult,
  decodeIssues: SyncRejection[],
): { next: ModelCapabilities; rejections: SyncRejection[] } {
  const next: ModelCapabilities = { ...current };
  const rejections: SyncRejection[] = [];
  const baseRejection = {
    provider: matchResult.provider,
    modelKey: matchResult.modelKey,
    scope: "reasoning" as const,
  };

  const webSearchFormat = webSearchFormatFor(matchResult);
  if (webSearchFormat) next.webSearchFormat = webSearchFormat;
  else delete next.webSearchFormat;

  if (!decodeIssues.some((issue) => issue.scope === "vision") && pi.input !== undefined) {
    if (pi.input.includes("image")) next.vision = true;
    else delete next.vision;
  }

  if (pi.reasoning === false) {
    if (current.reasoning === true) clearCapabilities(next, REASONING_CAPABILITY_KEYS);
    if (
      pi.thinkingLevelMap !== undefined
      || pi.compat?.thinkingFormat !== undefined
      || pi.compat?.supportsReasoningEffort !== undefined
    ) {
      rejections.push({ ...baseRejection, code: "reasoning_disabled_extras_ignored" });
    }
    return { next, rejections };
  }

  if (pi.reasoning !== true || decodeIssues.some((issue) => issue.scope === "reasoning")) {
    return { next, rejections };
  }

  const candidate = buildReasoningCandidate(current, pi);
  if (!candidate) {
    rejections.push({ ...baseRejection, code: "invalid_reasoning_bundle" });
    return { next, rejections };
  }
  const invalidCode = validReasoningBundle(candidate);
  if (invalidCode) {
    rejections.push({ ...baseRejection, code: invalidCode });
    return { next, rejections };
  }

  clearCapabilities(next, REASONING_CAPABILITY_KEYS);
  for (const key of REASONING_CAPABILITY_KEYS) {
    const value = candidate[key];
    if (value !== undefined) setCapability(next, key, value);
  }
  return { next, rejections };
}

function buildOperations(
  row: CatalogRow,
  nextCapabilities: ModelCapabilities,
  pi: PiModel,
): CatalogOperation[] {
  const operations: CatalogOperation[] = [];
  const forceReasoningDeletes = pi.reasoning === false && row.capabilities?.reasoning === true;
  const capabilityKeys = [...new Set([
    ...Object.keys(row.capabilities ?? {}),
    ...Object.keys(nextCapabilities),
    ...(forceReasoningDeletes ? REASONING_CAPABILITY_KEYS : []),
  ])].sort() as Array<keyof ModelCapabilities>;

  for (const key of capabilityKeys) {
    const before = row.capabilities?.[key];
    const after = nextCapabilities[key];
    const canonicalReasoningDelete = forceReasoningDeletes
      && after === undefined
      && REASONING_CAPABILITY_KEYS.includes(key);
    if (stableJson(before) === stableJson(after) && !canonicalReasoningDelete) continue;
    operations.push(after === undefined
      ? { target: "capability", action: "delete", key }
      : { target: "capability", action: "set", key, value: canonicalJsonValue(after) });
  }
  if (pi.contextWindow !== undefined && pi.contextWindow !== row.contextWindow) {
    operations.push({
      target: "column",
      action: "set",
      column: "contextWindow",
      value: pi.contextWindow,
    });
  }
  if (pi.maxTokens !== undefined && pi.maxTokens !== row.maxOutputTokens) {
    operations.push({
      target: "column",
      action: "set",
      column: "maxOutputTokens",
      value: pi.maxTokens,
    });
  }
  return operations;
}

/** 对现有 catalog 行做确定性对齐计划;reference proposal 永不进入 changes。 */
export function planCatalogSync(rows: CatalogRow[], payload: unknown): SyncPlan {
  const decoded = decodePiModelsApi(payload);
  const changes: SyncChange[] = [];
  const references: SyncChange[] = [];
  const generic: string[] = [];
  const unmatchedCatalog: string[] = [];
  const plannerRejections: SyncRejection[] = [];
  const canonicalBySource = new Map<string, string[]>();
  let matched = 0;
  let unchanged = 0;

  for (const row of [...rows].sort((left, right) =>
    left.canonicalModelId.localeCompare(right.canonicalModelId))) {
    if (row.canonicalModelId.startsWith("__generic_")) {
      generic.push(row.canonicalModelId);
      continue;
    }
    const m = match(row.canonicalModelId, row.aliases ?? [], decoded.catalog);
    if (!m) {
      unmatchedCatalog.push(row.canonicalModelId);
      continue;
    }
    matched += 1;
    const sourceKey = `${m.provider}\0${m.modelKey}`;
    canonicalBySource.set(sourceKey, [
      ...new Set([...(canonicalBySource.get(sourceKey) ?? []), row.canonicalModelId]),
    ]);
    const decodeIssues = decoded.rejections.filter((issue) =>
      issue.provider === m.provider && issue.modelKey === m.modelKey);
    const cur = row.capabilities ?? {};
    const proposal = proposeCapabilities(cur, m.pi, m, decodeIssues);
    const operations = buildOperations(row, proposal.next, m.pi);
    for (const rejection of proposal.rejections) {
      plannerRejections.push({ ...rejection, canonicalModelId: row.canonicalModelId });
    }
    if (m.reason === "ambiguous_direct_match") {
      plannerRejections.push({
        provider: m.provider,
        modelKey: m.modelKey,
        canonicalModelId: row.canonicalModelId,
        scope: "model",
        code: "ambiguous_direct_match",
      });
    }
    if (operations.length === 0) {
      unchanged += 1;
      continue;
    }
    const { pi: _pi, ...matchEvidence } = m;
    const syncChange: SyncChange = {
      canonicalModelId: row.canonicalModelId,
      name: row.name,
      match: matchEvidence,
      operations,
      nextCapabilities: canonicalJsonValue(proposal.next) as ModelCapabilities,
    };
    if (m.authority === "direct") changes.push(syncChange);
    else references.push(syncChange);
  }

  const decodedRejections = decoded.rejections.flatMap((rejection) => {
    const sourceKey = `${rejection.provider ?? ""}\0${rejection.modelKey ?? ""}`;
    const canonicalIds = canonicalBySource.get(sourceKey);
    return canonicalIds?.length
      ? canonicalIds.map((canonicalModelId) => ({ ...rejection, canonicalModelId }))
      : [rejection];
  });

  return {
    changes: changes.sort((left, right) => left.canonicalModelId.localeCompare(right.canonicalModelId)),
    references: references.sort((left, right) =>
      left.canonicalModelId.localeCompare(right.canonicalModelId)),
    rejections: sortRejections([...decodedRejections, ...plannerRejections]),
    matched,
    unchanged,
    unmatched: {
      generic: generic.sort(),
      catalog: unmatchedCatalog.sort(),
    },
  };
}

export interface JournalEntry {
  idx: number;
  version?: string;
  when?: number;
  tag: string;
  breakpoints?: boolean;
}

export interface DrizzleSnapshot {
  id: string;
  prevId: string;
  [key: string]: unknown;
}

/** 为不改变 schema 的数据迁移生成下一份 Drizzle snapshot。 */
export function nextDataMigrationSnapshot<T extends DrizzleSnapshot>(
  previous: T,
  nextId: string,
): T {
  return { ...previous, id: nextId, prevId: previous.id };
}

/** 计算下一条数据迁移的 idx/tag(不覆盖已有 sync 迁移)。 */
export function nextSyncMigrationSlot(
  entries: JournalEntry[],
  tagBase = "sync_pi_models",
): { idx: number; tag: string } {
  const maxIdx = entries.reduce((m, e) => Math.max(m, e.idx), -1);
  let idx = maxIdx + 1;
  let tag = `${String(idx).padStart(4, "0")}_${tagBase}`;
  const tags = new Set(entries.map((e) => e.tag));
  let n = 2;
  while (tags.has(tag)) {
    idx = maxIdx + n;
    tag = `${String(idx).padStart(4, "0")}_${tagBase}`;
    n += 1;
  }
  return { idx, tag };
}
