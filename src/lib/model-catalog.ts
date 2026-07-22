export interface CatalogMatchEntry {
  id: string;
  canonicalModelId: string;
  aliases: string[];
}

export interface SimilarModelEntry extends CatalogMatchEntry {
  name: string;
  catalogId: string;
}

export function normalizeCatalogModelId(value: string): string {
  return value.trim().toLowerCase();
}

export function findCatalogMatch<T extends CatalogMatchEntry>(
  entries: T[],
  modelId: string,
): T | null {
  const normalized = normalizeCatalogModelId(modelId);
  return entries.find((entry) => {
    if (entry.canonicalModelId.startsWith("__generic_")) return false;
    if (normalizeCatalogModelId(entry.canonicalModelId) === normalized) return true;
    return entry.aliases.some((alias) => normalizeCatalogModelId(alias) === normalized);
  }) ?? null;
}

/** 用于候选检索的保守归一；路由写入仍使用未经改写的上游模型 ID。 */
export function normalizeComparableModelId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return tail.replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function stripRevisionSuffix(value: string): string {
  return value.replace(/-(?:latest|\d{8}|\d{4}-\d{2}-\d{2})$/, "");
}

function tokenizeModelId(value: string): string[] {
  return value.split(/[-:]+/).filter(Boolean);
}

function diceCoefficient(left: string[], right: string[]): number {
  const remaining = [...right];
  let common = 0;
  for (const token of left) {
    const index = remaining.indexOf(token);
    if (index === -1) continue;
    common += 1;
    remaining.splice(index, 1);
  }
  return left.length + right.length === 0 ? 0 : (2 * common) / (left.length + right.length);
}

function bigramSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const rightPairs: string[] = [];
  for (let i = 0; i < right.length - 1; i += 1) rightPairs.push(right.slice(i, i + 2));
  let common = 0;
  for (let i = 0; i < left.length - 1; i += 1) {
    const pair = left.slice(i, i + 2);
    const index = rightPairs.indexOf(pair);
    if (index === -1) continue;
    common += 1;
    rightPairs.splice(index, 1);
  }
  return (2 * common) / (left.length + right.length - 2);
}

function hasSizeConflict(left: string[], right: string[]): boolean {
  const sizePattern = /^\d+(?:\.\d+)?b$/;
  const leftSizes = left.filter((token) => sizePattern.test(token));
  const rightSizes = right.filter((token) => sizePattern.test(token));
  return leftSizes.length > 0 && rightSizes.length > 0 && !leftSizes.some((size) => rightSizes.includes(size));
}

function containsAtTokenBoundary(left: string, right: string): boolean {
  return (
    left.startsWith(`${right}-`) ||
    right.startsWith(`${left}-`) ||
    left.endsWith(`-${right}`) ||
    right.endsWith(`-${left}`)
  );
}

/**
 * 已有模型候选排序：目录语义优先，随后才比较保守归一后的 ID。
 * 返回原始条目并保持同分输入顺序；候选只供用户确认，不会触发自动绑定。
 */
export function rankSimilarModels<T extends SimilarModelEntry>(
  entries: T[],
  modelId: string,
  limit = 5,
): T[] {
  const requested = modelId.trim();
  const normalized = normalizeComparableModelId(requested);
  const revisionBase = stripRevisionSuffix(normalized);
  const requestedTokens = tokenizeModelId(normalized);

  return entries
    .map((entry, index) => {
      if (entry.name.trim() === requested) return null;
      const candidate = normalizeComparableModelId(entry.name);
      if (!candidate || !normalized) return null;
      const candidateBase = stripRevisionSuffix(candidate);
      const candidateTokens = tokenizeModelId(candidate);
      const catalogMatch = findCatalogMatch([entry], requested) !== null;
      const sizeConflict = hasSizeConflict(requestedTokens, candidateTokens);

      let tier = 0;
      let similarity = bigramSimilarity(normalized, candidate);
      if (catalogMatch) tier = 5;
      else if (candidate === normalized) tier = 4;
      else if (candidateBase === revisionBase) tier = 3;
      else if (!sizeConflict && containsAtTokenBoundary(normalized, candidate)) tier = 2;
      else if (!sizeConflict) {
        const commonTokens = requestedTokens.filter((token) => candidateTokens.includes(token)).length;
        const tokenSimilarity = diceCoefficient(requestedTokens, candidateTokens);
        if (commonTokens >= 2 && tokenSimilarity >= 0.75 && similarity >= 0.65) {
          tier = 1;
          similarity = (similarity + tokenSimilarity) / 2;
        }
      }

      return tier > 0 ? { entry, index, tier, similarity } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.tier - left.tier || right.similarity - left.similarity || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.entry);
}

/**
 * 显示名为空时的回退优先级:显示名 → 目录名 → 对外模型名。
 * 通用模板(__generic_*)的目录名是泛称(如"通用对话模型"),不适合做显示名,
 * 此时跳过目录名直接用对外模型名。
 * 供 server action 在写入 displayName 时统一兜底。
 */
export function pickDisplayName(
  rawDisplayName: string,
  catalogName: string | undefined | null,
  fallbackName: string,
  catalogCanonicalId?: string | null,
): string {
  const trimmed = rawDisplayName.trim();
  if (trimmed) return trimmed;
  if (catalogCanonicalId?.startsWith("__generic_")) return fallbackName;
  return catalogName || fallbackName;
}
