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
import type { ModelCapabilities, ThinkingFormat, ThinkingLevelMap } from "@/db/types";

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

export interface MatchResult { pi: PiModel; via: string; }

export interface SyncChange {
  canonicalModelId: string;
  name: string;
  via: string;
  nextCaps: ModelCapabilities;
  ctxNew: number | null;
  maxNew: number | null;
  capChanges: string[];
  ctxChange: string | null;
  maxChange: string | null;
  gateFallback: boolean;
}

export interface SyncPlan {
  changes: SyncChange[];
  matched: number;
  unchanged: number;
  unmatched: string[];
}

function providerRank(p: string): number {
  const i = PROVIDER_RANK.indexOf(p);
  return i === -1 ? 1000 : i;
}

/** 多 provider 命中时选主源:非聚合/非变体优先,再按 PROVIDER_RANK。 */
export function pickProvider(pool: string[]): string | null {
  if (pool.length === 0) return null;
  const primary = pool.filter((p) => !AGGREGATOR.has(p) && !isVariant(p));
  const candidates = primary.length ? primary : pool.filter((p) => !isVariant(p));
  const finalPool = candidates.length ? candidates : pool;
  return [...finalPool].sort(
    (a, b) => providerRank(a) - providerRank(b) || a.localeCompare(b),
  )[0] ?? null;
}

function modelTail(key: string): string {
  const base = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
  return base.toLowerCase().replace(/:free$/i, "");
}

function lookupKey(PI: PiCatalog, key: string): Array<{ provider: string; modelKey: string }> {
  const hits: Array<{ provider: string; modelKey: string }> = [];
  const lower = key.toLowerCase();
  const tail = modelTail(key);
  for (const provider of Object.keys(PI)) {
    const models = PI[provider];
    if (models[key]) {
      hits.push({ provider, modelKey: key });
      continue;
    }
    let matched = false;
    for (const modelKey of Object.keys(models)) {
      if (modelKey.toLowerCase() === lower) {
        hits.push({ provider, modelKey });
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // 尾段匹配: step-3.5-flash ≈ stepfun-ai/Step-3.5-Flash
    for (const modelKey of Object.keys(models)) {
      const m = models[modelKey];
      if (modelTail(modelKey) === tail || modelTail(m.id) === tail) {
        hits.push({ provider, modelKey });
        break;
      }
    }
  }
  return hits;
}

interface Candidate {
  provider: string;
  modelKey: string;
  pi: PiModel;
  via: string;
  /** 精确 provider/id 命中(最高优先)。 */
  exact: boolean;
  /** 路径首段与 provider 一致(nvidia/xxx @ nvidia)。 */
  owner: boolean;
}

function isFreeKey(key: string): boolean {
  return key.includes(":free") || key.endsWith("-free");
}

/** 候选排序:精确 > 主源 owner > 非 free > 非聚合 > 大窗口 > 大 max > provider rank。 */
function betterCandidate(a: Candidate, b: Candidate): number {
  if (a.exact !== b.exact) return a.exact ? -1 : 1;
  if (a.owner !== b.owner) return a.owner ? -1 : 1;
  const aFree = isFreeKey(a.modelKey);
  const bFree = isFreeKey(b.modelKey);
  if (aFree !== bFree) return aFree ? 1 : -1;
  const aAgg = AGGREGATOR.has(a.provider) || isVariant(a.provider);
  const bAgg = AGGREGATOR.has(b.provider) || isVariant(b.provider);
  if (aAgg !== bAgg) return aAgg ? 1 : -1;
  const aCtx = a.pi.contextWindow ?? 0;
  const bCtx = b.pi.contextWindow ?? 0;
  if (aCtx !== bCtx) return bCtx - aCtx;
  const aMax = a.pi.maxTokens ?? 0;
  const bMax = b.pi.maxTokens ?? 0;
  if (aMax !== bMax) return bMax - aMax;
  return providerRank(a.provider) - providerRank(b.provider) || a.via.localeCompare(b.via);
}

/** 匹配:收集精确 provider/id、全路径 key、裸 id 全部候选后择优。 */
export function match(
  canon: string,
  aliases: string[],
  PI: PiCatalog,
): MatchResult | null {
  const all = [canon, ...aliases];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const push = (c: Candidate) => {
    const k = `${c.provider}\0${c.modelKey}`;
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(c);
  };

  // 1) 精确 provider/id(别名形如 zai/glm-5.2)
  for (const a of all) {
    const s = a.indexOf("/");
    if (s <= 0) continue;
    const p = a.slice(0, s);
    const id = a.slice(s + 1);
    if (!PI[p]?.[id]) continue;
    push({
      provider: p,
      modelKey: id,
      pi: PI[p][id],
      via: `${p}/${id}`,
      exact: true,
      owner: true,
    });
  }

  // 2) 整段别名作为某 provider 下的 model key
  for (const a of all) {
    if (!a.includes("/")) continue;
    const owner = a.slice(0, a.indexOf("/"));
    for (const hit of lookupKey(PI, a)) {
      push({
        provider: hit.provider,
        modelKey: hit.modelKey,
        pi: PI[hit.provider][hit.modelKey],
        via: `${hit.provider}/${hit.modelKey}`,
        exact: false,
        owner: hit.provider === owner,
      });
    }
  }

  // 3) 裸 id
  for (const id of all.filter((a) => !a.includes("/"))) {
    for (const hit of lookupKey(PI, id)) {
      push({
        provider: hit.provider,
        modelKey: hit.modelKey,
        pi: PI[hit.provider][hit.modelKey],
        via: `${hit.provider}/${hit.modelKey}`,
        exact: false,
        owner: false,
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort(betterCandidate);
  const best = candidates[0];
  return { pi: best.pi, via: best.via };
}

/** 将 pi.dev/api/models JSON 规范为 PiCatalog。 */
export function parsePiModelsApi(data: unknown): PiCatalog {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("pi models payload 非法:期望 { provider: { modelId: {...} } }");
  }
  const out: PiCatalog = {};
  for (const [provider, models] of Object.entries(data as Record<string, unknown>)) {
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    const bucket: Record<string, PiModel> = {};
    for (const [modelKey, raw] of Object.entries(models as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const m = raw as Record<string, unknown>;
      const compatRaw = m.compat;
      let compat: PiModel["compat"];
      if (compatRaw && typeof compatRaw === "object" && !Array.isArray(compatRaw)) {
        const c = compatRaw as Record<string, unknown>;
        compat = {
          thinkingFormat: typeof c.thinkingFormat === "string" ? c.thinkingFormat : undefined,
          supportsReasoningEffort: c.supportsReasoningEffort === true ? true : undefined,
        };
      }
      let thinkingLevelMap: PiModel["thinkingLevelMap"];
      if (m.thinkingLevelMap && typeof m.thinkingLevelMap === "object" && !Array.isArray(m.thinkingLevelMap)) {
        thinkingLevelMap = m.thinkingLevelMap as Record<string, string | null>;
      }
      const input = Array.isArray(m.input)
        ? m.input.filter((v): v is string => typeof v === "string")
        : undefined;
      bucket[modelKey] = {
        id: typeof m.id === "string" ? m.id : modelKey,
        name: typeof m.name === "string" ? m.name : undefined,
        api: typeof m.api === "string" ? m.api : undefined,
        compat,
        reasoning: m.reasoning === true,
        thinkingLevelMap,
        input,
        contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
        maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
      };
    }
    if (Object.keys(bucket).length) out[provider] = bucket;
  }
  return out;
}

/**
 * thinkingFormat:
 * - KEEP(fixed/agnes/anthropic-adaptive) 始终保留
 * - pi 给了 OVERLAP 且非网关格式 → 采用
 * - pi 给了 openrouter/together 网关格式 → 不覆盖已有模型官方格式
 * - 否则保留现状(不再清空 google/anthropic/openai/qwen 等)
 */
export function resolveThinkingFormat(cur: ModelCapabilities, pi: PiModel): ThinkingFormat | undefined {
  if (cur.thinkingFormat && KEEP.has(cur.thinkingFormat)) return cur.thinkingFormat;
  const pf = pi.compat?.thinkingFormat;
  if (typeof pf === "string" && OVERLAP.has(pf) && !AGGREGATOR_FORMATS.has(pf)) {
    return pf as ThinkingFormat;
  }
  // 网关 format(openrouter/together)与未知 format:保留现状,不写入 catalog
  return cur.thinkingFormat;
}

/** thinkingLevelMap:仅非 fixed 的 openai-completions 系(pi 给了非网关 thinkingFormat)才采用 pi 的 map;
 *  原生 API(claude/gemini/openai-responses)档位映射走 DEFAULT_MAP + providerOptions,
 *  刷 pi 的 map 会改请求行为,故保现状,仅规范化空串。 */
export function resolveThinkingLevelMap(cur: ModelCapabilities, pi: PiModel): ThinkingLevelMap | undefined {
  const pf = pi.compat?.thinkingFormat;
  if (cur.thinkingFormat !== "fixed" && pf && !AGGREGATOR_FORMATS.has(pf) && pi.thinkingLevelMap) {
    return pi.thinkingLevelMap as ThinkingLevelMap;
  }
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

/** 闸门:reasoning=true 时刷后必须有可显档;fixed 必须恰好一个。 */
export function passesInvariants(cap: ModelCapabilities): boolean {
  if (!cap.reasoning) return true;
  const levels = getSupportedReasoningLevels(cap);
  return cap.thinkingFormat === "fixed" ? levels.length === 1 : levels.length > 0;
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

/** 全量导入用:含 aliases / context / max / sort_order。ON CONFLICT 补 aliases 并更新窗口与能力。 */
export function buildImportUpsert(
  canon: string,
  name: string,
  aliases: string[],
  cap: ModelCapabilities,
  ctx: number | null,
  max: number | null,
  sortOrder: number,
): string {
  const capJson = JSON.stringify(cap).replace(/'/g, "''");
  const aliasJson = JSON.stringify(aliases).replace(/'/g, "''");
  const sets = [
    `"name" = EXCLUDED."name"`,
    `"aliases" = EXCLUDED."aliases"`,
    `"capabilities" = EXCLUDED."capabilities"`,
    `"sort_order" = EXCLUDED."sort_order"`,
    `"enabled" = true`,
    `"updated_at" = now()`,
  ];
  if (ctx != null) sets.push(`"context_window" = EXCLUDED."context_window"`);
  if (max != null) sets.push(`"max_output_tokens" = EXCLUDED."max_output_tokens"`);
  const ctxSql = ctx == null ? "NULL" : String(ctx);
  const maxSql = max == null ? "NULL" : String(max);
  return (
    `INSERT INTO "model_catalog" (` +
    `"id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", ` +
    `"context_window", "max_output_tokens", "sort_order"` +
    `) VALUES (` +
    `gen_random_uuid(), ${sqlLit(canon)}, ${sqlLit(name)}, '${aliasJson}'::jsonb, 'chat', ` +
    `'${capJson}'::jsonb, ${ctxSql}, ${maxSql}, ${sortOrder}` +
    `)\nON CONFLICT ("canonical_model_id") DO UPDATE SET\n  ` +
    sets.join(",\n  ") + ";"
  );
}

/**
 * 从 pi model key / id 得到 catalog canon:
 * - 去 org 路径前缀、:free
 * - 去 bedrock 区域/厂商前缀(au.anthropic.xxx → xxx)
 * - 保留原始大小写与点号风格(展示用);分组键另做归一
 */
export function canonicalFromPi(modelKey: string, pi: PiModel): string {
  let raw = (pi.id || modelKey).trim();
  if (raw.includes("/")) raw = raw.slice(raw.lastIndexOf("/") + 1);
  raw = raw.replace(/:free$/i, "").replace(/-free$/i, "");
  // bedrock / 区域前缀
  raw = raw.replace(/^(au|us|eu|apac|global)\./i, "");
  raw = raw.replace(/^anthropic\./i, "");
  raw = raw.replace(/^amazon\./i, "");
  raw = raw.replace(/^openai\./i, "");
  // openrouter 假名 ~anthropic/xxx 已在路径阶段去掉
  raw = raw.replace(/^~/, "");
  return raw;
}

/** 分组/去重键:小写 + 点改横线,合并 claude-opus-4.6 与 claude-opus-4-6。 */
export function groupKeyFromCanon(canon: string): string {
  return canon.toLowerCase().replace(/\./g, "-");
}

export interface PiOccurrence {
  provider: string;
  modelKey: string;
  pi: PiModel;
  free: boolean;
}

export interface ImportCandidate {
  canonicalModelId: string;
  name: string;
  aliases: string[];
  capabilities: ModelCapabilities;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  via: string;
  providers: string[];
}

/** 将 pi 全量展平并按归一化 groupKey 分组(free / 区域 / 4.6↔4-6 并入同组)。 */
export function groupPiModels(PI: PiCatalog): Map<string, PiOccurrence[]> {
  const groups = new Map<string, PiOccurrence[]>();
  for (const [provider, models] of Object.entries(PI)) {
    if (isVariant(provider)) continue;
    for (const [modelKey, pi] of Object.entries(models)) {
      const canon = canonicalFromPi(modelKey, pi);
      if (!canon || canon.startsWith("__")) continue;
      // 过滤无意义聚合入口
      const gk = groupKeyFromCanon(canon);
      if (!gk || gk === "auto" || gk === "auto-beta") continue;
      const list = groups.get(gk) ?? [];
      list.push({
        provider,
        modelKey,
        pi,
        free: isFreeKey(modelKey) || isFreeKey(pi.id || ""),
      });
      groups.set(gk, list);
    }
  }
  return groups;
}

function pickBestOccurrence(list: PiOccurrence[]): PiOccurrence {
  const scored = [...list].sort((a, b) => {
    // 非 free 优先
    if (a.free !== b.free) return a.free ? 1 : -1;
    const aAgg = AGGREGATOR.has(a.provider);
    const bAgg = AGGREGATOR.has(b.provider);
    if (aAgg !== bAgg) return aAgg ? 1 : -1;
    const aCtx = a.pi.contextWindow ?? 0;
    const bCtx = b.pi.contextWindow ?? 0;
    if (aCtx !== bCtx) return bCtx - aCtx;
    const aMax = a.pi.maxTokens ?? 0;
    const bMax = b.pi.maxTokens ?? 0;
    if (aMax !== bMax) return bMax - aMax;
    return providerRank(a.provider) - providerRank(b.provider)
      || a.provider.localeCompare(b.provider)
      || a.modelKey.localeCompare(b.modelKey);
  });
  return scored[0];
}

function buildAliases(canon: string, list: PiOccurrence[], best: PiOccurrence): string[] {
  const aliases = new Set<string>();
  for (const occ of list) {
    const id = occ.pi.id || occ.modelKey;
    if (id && id !== canon) aliases.add(id);
    if (occ.modelKey !== canon) aliases.add(occ.modelKey);
    const path = `${occ.provider}/${occ.modelKey}`;
    // 避免 openrouter/openrouter/xxx 这类重复前缀时仍保留 provider/key
    if (path !== canon) aliases.add(path);
    if (!occ.modelKey.includes("/")) {
      aliases.add(`${occ.provider}/${occ.modelKey}`);
    }
  }
  aliases.delete(canon);
  // 主源路径优先靠前
  const primary = `${best.provider}/${best.modelKey}`;
  const rest = [...aliases].filter((a) => a !== primary).sort((a, b) => a.localeCompare(b));
  return primary !== canon ? [primary, ...rest] : rest;
}

function capsFromPi(pi: PiModel): ModelCapabilities {
  const cap = translate(
    { systemPrompt: true, tools: true },
    pi,
  );
  if (!passesInvariants(cap)) {
    // 新导入:无历史 map 可回退时,关掉 reasoning 避免不可用配置
    if (cap.reasoning && getSupportedReasoningLevels(cap).length === 0) {
      cap.reasoning = false;
      delete cap.thinkingLevelMap;
      delete cap.thinkingFormat;
      delete cap.reasoningEffort;
    }
  }
  return cap;
}

function existingIndex(rows: CatalogRow[]): Set<string> {
  const keys = new Set<string>();
  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    keys.add(groupKeyFromCanon(v));
    keys.add(groupKeyFromCanon(modelTail(v)));
  };
  for (const row of rows) {
    if (row.canonicalModelId.startsWith("__generic_")) continue;
    add(row.canonicalModelId);
    for (const a of row.aliases ?? []) add(a);
  }
  return keys;
}

function alreadyHave(
  canon: string,
  aliases: string[],
  index: Set<string>,
): boolean {
  if (index.has(groupKeyFromCanon(canon))) return true;
  for (const a of aliases) {
    if (index.has(groupKeyFromCanon(a)) || index.has(groupKeyFromCanon(modelTail(a)))) {
      return true;
    }
  }
  return false;
}

/**
 * 计算 pi 中有、catalog 中没有的型号,去重后生成导入候选。
 * 同 canon 多 provider 只保留一条(主源择优),其余进 aliases。
 */
export function planMissingImports(
  rows: CatalogRow[],
  PI: PiCatalog,
): { imports: ImportCandidate[]; groupCount: number; skippedExisting: number } {
  const index = existingIndex(rows);
  const groups = groupPiModels(PI);
  const imports: ImportCandidate[] = [];
  let skippedExisting = 0;

  for (const [, list] of groups) {
    const best = pickBestOccurrence(list);
    // 优先用非聚合主源的 canon,避免 openrouter 的奇怪命名
    const preferred = [...list].sort((a, b) => {
      const aAgg = AGGREGATOR.has(a.provider) ? 1 : 0;
      const bAgg = AGGREGATOR.has(b.provider) ? 1 : 0;
      if (aAgg !== bAgg) return aAgg - bAgg;
      return providerRank(a.provider) - providerRank(b.provider);
    })[0] ?? best;
    const canon = canonicalFromPi(preferred.modelKey, preferred.pi);
    const aliases = buildAliases(canon, list, best);
    if (alreadyHave(canon, aliases, index)) {
      skippedExisting += 1;
      continue;
    }
    // 名称优先官方源
    const name = (preferred.pi.name || best.pi.name || canon).trim();
    imports.push({
      canonicalModelId: canon,
      name,
      aliases,
      capabilities: capsFromPi(best.pi),
      contextWindow: best.pi.contextWindow ?? null,
      maxOutputTokens: best.pi.maxTokens ?? null,
      via: `${best.provider}/${best.modelKey}`,
      providers: [...new Set(list.map((x) => x.provider))].sort(),
    });
  }

  imports.sort((a, b) => a.canonicalModelId.localeCompare(b.canonicalModelId));
  return { imports, groupCount: groups.size, skippedExisting };
}

/** 对现有 catalog 行做 pi 对齐计划(仅更新已有行,不自动 insert 新 canon)。 */
export function planCatalogSync(rows: CatalogRow[], PI: PiCatalog): SyncPlan {
  const changes: SyncChange[] = [];
  const unmatched: string[] = [];
  let matched = 0;
  let unchanged = 0;

  for (const row of rows) {
    // 跳过通用模板
    if (row.canonicalModelId.startsWith("__generic_")) {
      unmatched.push(row.canonicalModelId);
      continue;
    }
    const m = match(row.canonicalModelId, row.aliases ?? [], PI);
    if (!m) {
      unmatched.push(row.canonicalModelId);
      continue;
    }
    matched += 1;
    const cur = row.capabilities ?? {};
    const next = translate(cur, m.pi);
    let gateFallback = false;
    if (!passesInvariants(next)) {
      gateFallback = true;
      next.thinkingLevelMap = cur.thinkingLevelMap;
    }
    const capChanges = diffCaps(cur, next);
    const ctxNew = m.pi.contextWindow ?? null;
    const maxNew = m.pi.maxTokens ?? null;
    const ctxChange = ctxNew != null && ctxNew !== row.contextWindow
      ? `${row.contextWindow} → ${ctxNew}`
      : null;
    const maxChange = maxNew != null && maxNew !== row.maxOutputTokens
      ? `${row.maxOutputTokens} → ${maxNew}`
      : null;
    if (capChanges.length === 0 && !ctxChange && !maxChange && !gateFallback) {
      unchanged += 1;
      continue;
    }
    changes.push({
      canonicalModelId: row.canonicalModelId,
      name: row.name,
      via: m.via,
      nextCaps: next,
      ctxNew,
      maxNew,
      capChanges,
      ctxChange,
      maxChange,
      gateFallback,
    });
  }

  return { changes, matched, unchanged, unmatched };
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
