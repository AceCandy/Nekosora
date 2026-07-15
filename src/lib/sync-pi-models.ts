/**
 * pi 模型配置同步的纯逻辑(无 IO/DB)。scripts/sync-pi-models.ts 负责 IO 与迁移生成;
 * 此处函数可单测。
 *
 * 三不变量(最高优先级):
 *   1. 不显示推理强度 ⇒ reasoning !== true
 *   2. 显示但单一强度 ⇒ 开且不可调(levels 恰好 1 个非 off 档)
 *   3. 显示 ⇒ 可调,只显示真实拥有的强度档
 */
import { getSupportedReasoningLevels } from "@/lib/reasoning";
import type { ModelCapabilities, ThinkingFormat, ThinkingLevelMap } from "@/db/types";

/** pi 模型条目的最小结构(从 docs/cankao/pi 的 Model<Api> 取用)。 */
export interface PiModel {
  id: string;
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

// pi 的 9 个 OpenAI-compatible 改写格式:命中则采用 pi 值。
export const OVERLAP = new Set<string>([
  "openai", "openrouter", "deepseek", "together", "zai",
  "qwen", "qwen-chat-template", "string-thinking", "ant-ling",
]);
// 我们独有、pi 无对应、且有实质作用/产品语义的格式:保留不动。
export const KEEP = new Set<string>(["fixed", "agnes", "anthropic-adaptive"]);
// bare 匹配时排除聚合 provider 与区域变体,优先官方主 provider。
export const AGGREGATOR = new Set([
  "opencode", "opencode-go", "openrouter", "azure-openai-responses",
  "cloudflare-ai-gateway", "github-copilot", "google-vertex", "fireworks",
  "groq", "nvidia", "together", "huggingface", "cerebras",
  "cloudflare-workers-ai", "vercel-ai-gateway", "amazon-bedrock",
]);
export const isVariant = (p: string): boolean => /-(cn|ams|sgp)$/.test(p) || p === "zai-coding-cn";

export interface MatchResult { pi: PiModel; via: string; }

/** 匹配:精确 provider/id 优先;否则裸 id 过滤聚合/变体后取唯一命中。 */
export function match(
  canon: string,
  aliases: string[],
  PI: Record<string, Record<string, PiModel>>,
): MatchResult | null {
  const all = [canon, ...aliases];
  for (const a of all) {
    const s = a.indexOf("/");
    if (s > 0) {
      const p = a.slice(0, s), id = a.slice(s + 1);
      if (PI[p]?.[id]) return { pi: PI[p][id], via: `${p}/${id}` };
    }
  }
  for (const id of all.filter((a) => !a.includes("/"))) {
    const hits = Object.keys(PI).filter((p) => PI[p][id]);
    const primary = hits.filter((p) => !AGGREGATOR.has(p) && !isVariant(p));
    const pool = primary.length ? primary : hits;
    if (pool.length === 1) return { pi: PI[pool[0]][id], via: `${pool[0]}/${id}` };
  }
  return null;
}

/** thinkingFormat:KEEP 保留;pi 给了重叠格式则采用;否则去标识(claude/gemini/openai 原生)。 */
export function resolveThinkingFormat(cur: ModelCapabilities, pi: PiModel): ThinkingFormat | undefined {
  if (cur.thinkingFormat && KEEP.has(cur.thinkingFormat)) return cur.thinkingFormat;
  const pf = pi.compat?.thinkingFormat;
  if (typeof pf === "string" && OVERLAP.has(pf)) return pf as ThinkingFormat;
  return undefined;
}

/** thinkingLevelMap:仅 openai-completions 系(pi 给了 thinkingFormat)才采用 pi 的 map;
 *  原生 API(claude/gemini/openai-responses)档位映射走 DEFAULT_MAP + providerOptions,
 *  刷 pi 的 map 会改请求行为,故保现状,仅规范化空串。 */
export function resolveThinkingLevelMap(cur: ModelCapabilities, pi: PiModel): ThinkingLevelMap | undefined {
  if (pi.compat?.thinkingFormat && pi.thinkingLevelMap) return pi.thinkingLevelMap as ThinkingLevelMap;
  const cur2 = cur.thinkingLevelMap;
  if (!cur2) return undefined;
  let changed = false;
  const norm: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(cur2)) {
    if (v === "") { norm[k] = k; changed = true; } else norm[k] = v;
  }
  return changed ? (norm as ThinkingLevelMap) : cur2;
}

/** 按 pi 翻译目标 capabilities。vision/reasoning 只升不降(保守,避免误关能力)。 */
export function translate(cur: ModelCapabilities, pi: PiModel): ModelCapabilities {
  const cap: ModelCapabilities = { ...cur };
  cap.reasoning = pi.reasoning ? true : cur.reasoning;
  if (pi.input?.includes("image")) cap.vision = true;
  if (pi.compat?.supportsReasoningEffort) cap.reasoningEffort = true;
  cap.thinkingFormat = resolveThinkingFormat(cur, pi);
  cap.thinkingLevelMap = resolveThinkingLevelMap(cur, pi);
  return cap;
}

/** 闸门:reasoning=true 时刷后必须有可显档(否则配置错误)。 */
export function passesInvariants(cap: ModelCapabilities): boolean {
  if (!cap.reasoning) return true;
  return getSupportedReasoningLevels(cap).length > 0;
}

/** 规范化 JSON(对象按 key 排序),消除同值不同序的误报。 */
export function stableJson(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return JSON.stringify(v, Object.keys(v as object).sort());
  }
  return JSON.stringify(v);
}

export function diffCaps(cur: ModelCapabilities, next: ModelCapabilities): string[] {
  const keys = new Set([...Object.keys(cur), ...Object.keys(next)]);
  const out: string[] = [];
  for (const k of keys) {
    const a = (cur as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    if (stableJson(a) !== stableJson(b)) {
      out.push(`${k}: ${stableJson(a)} → ${stableJson(b)}`);
    }
  }
  return out;
}

export function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** 生成单条幂等 upsert SQL。INSERT 补全 NOT NULL 列(name/model_type);
 *  ON CONFLICT 时仅 UPDATE capabilities/ctx/max。 */
export function buildUpsert(
  canon: string,
  name: string,
  cap: ModelCapabilities,
  ctx: number | null,
  max: number | null,
): string {
  const capJson = JSON.stringify(cap).replace(/'/g, "''");
  const sets = [`"capabilities" = '${capJson}'::jsonb`];
  if (ctx != null) sets.push(`"context_window" = ${ctx}`);
  if (max != null) sets.push(`"max_output_tokens" = ${max}`);
  return (
    `INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") ` +
    `VALUES (gen_random_uuid(), ${sqlLit(canon)}, ${sqlLit(name)}, 'chat', '${capJson}'::jsonb)\n` +
    `ON CONFLICT ("canonical_model_id") DO UPDATE SET\n  ` +
    sets.join(",\n  ") + ";"
  );
}
