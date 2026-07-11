export interface CatalogMatchEntry {
  id: string;
  canonicalModelId: string;
  aliases: string[];
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
