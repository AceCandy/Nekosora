/**
 * API Key Bundle —— 统一解析/选择多 key 逻辑。
 *
 * 同一个 Provider 可能持有多个 api key(同一个上游地址的不同 key),每个 key 可配权重。
 * 所有 provider(global / BYO)的加密密钥列都存成"加密后的 bundle JSON",格式:
 *   { keys: [{ key: string, weight: number }] }
 *
 * 历史格式(向后兼容,parseKeyBundle 自动识别):
 *   1. 裸字符串:BYO 旧数据,decrypt 后非 JSON → 视作单个 key,weight=1。
 *   2. { keys: string[] }:全局旧数据 → 全部 weight=1。
 *   3. { keys: [{ key, weight }] }:新格式。
 *
 * 选择策略:按 weight 加权随机(无状态,无需跨 worker 共享计数)。
 * 失败转移:调用方(stream.ts)在同一 provider 内换 key 重试,见 orderedWeightedKeys。
 */
import { decrypt, encrypt } from "@/lib/infra/crypto";

/** 一个加权 key 条目。 */
export interface WeightedKey {
  key: string;
  weight: number;
}

/** 历史 bundle 形状(解析用,松散校验)。 */
interface LegacyKeyEntry {
  key?: string;
  weight?: number;
}
interface LegacyBundle {
  keys?: (string | LegacyKeyEntry)[];
  key?: string;
}

/**
 * 解密 + 解析加密密钥列,返回归一化后的加权 key 列表。
 *
 * @param encBundle provider 表里的加密列值(已加密)。
 * @returns 非空则返回 WeightedKey[];无法解析/空时返回 []。
 */
export function parseKeyBundle(encBundle: string): WeightedKey[] {
  const json = decrypt(encBundle);
  try {
    const parsed = JSON.parse(json) as LegacyBundle;
    if (Array.isArray(parsed.keys)) {
      return parsed.keys
        .map((k) => normalizeEntry(k))
        .filter((k): k is WeightedKey => k.key.length > 0);
    }
    if (typeof parsed.key === "string" && parsed.key.length > 0) {
      return [{ key: parsed.key, weight: 1 }];
    }
  } catch {
    // 非 JSON:当作裸 key(BYO 旧数据)。
    if (json.trim().length > 0) return [{ key: json, weight: 1 }];
  }
  return [];
}

/** 把历史条目(string | object)归一化为 WeightedKey。 */
function normalizeEntry(entry: string | LegacyKeyEntry): WeightedKey {
  if (typeof entry === "string") return { key: entry, weight: 1 };
  const weight = typeof entry.weight === "number" && entry.weight >= 0 ? entry.weight : 1;
  return { key: String(entry.key ?? ""), weight };
}

/** 把明文加权 key 列表加密成可入库的 bundle 字符串。 */
export function encryptKeyBundle(keys: WeightedKey[]): string {
  const payload = JSON.stringify({ keys });
  return encrypt(payload);
}

/**
 * 加权随机抽一个 key。
 * 复用 routing.weightedShuffle 的权重抽取算法(无放回单次抽取版)。
 * 全部 weight<=0 时退化为均匀随机。
 */
export function pickWeightedKey(keys: WeightedKey[]): string {
  const list = keys.length > 0 ? keys : [{ key: "", weight: 1 }];
  const total = list.reduce((sum, k) => sum + Math.max(k.weight, 0), 0);
  if (total <= 0) {
    return list[Math.floor(Math.random() * list.length)].key;
  }
  let pick = Math.random() * total;
  for (const k of list) {
    pick -= Math.max(k.weight, 0);
    if (pick <= 0) return k.key;
  }
  return list[list.length - 1].key;
}

/**
 * 加权随机打乱 key 序列(无放回),返回本轮尝试顺序。
 * stream.ts 用它做"同 provider 内逐 key 重试":权重高的先试。
 */
export function orderedWeightedKeys(keys: WeightedKey[]): WeightedKey[] {
  // 无 key provider(如 OVH 免费层):keys 为空时尝试一次空 key,
  // 与 pickWeightedKey 的兜底对齐,让 stream.ts 故障转移循环能执行。
  if (keys.length === 0) return [{ key: "", weight: 1 }];
  const remaining = [...keys];
  const out: WeightedKey[] = [];
  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, k) => sum + Math.max(k.weight, 0), 0);
    if (totalWeight <= 0) {
      out.push(...remaining);
      break;
    }
    let pick = Math.random() * totalWeight;
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      pick -= Math.max(remaining[idx].weight, 0);
      if (pick <= 0) break;
    }
    out.push(remaining.splice(Math.min(idx, remaining.length - 1), 1)[0]);
  }
  return out;
}

/**
 * 统计 bundle 内 key 数量(不解出明文 key,只返回条数)。
 * 用于管理后台列表展示"Key 数"列。解析失败时返回 0。
 */
export function countKeys(encBundle: string): number {
  try {
    return parseKeyBundle(encBundle).length;
  } catch {
    return 0;
  }
}

/**
 * 解密 bundle 并返回明文 key 列表(含权重)。
 *
 * 用途:编辑表单回显已存的 key(默认以密文点显示,点眼睛看明文)。
 * 注意:这是唯一会把明文 key 交给前端的地方,仅在管理/BYO 编辑场景调用;
 *      返回值会进入该页面的 HTML,请勿用于列表/日志/用量等批量场景。
 */
export function revealKeyBundle(encBundle: string): WeightedKey[] {
  try {
    return parseKeyBundle(encBundle);
  } catch {
    return [];
  }
}
