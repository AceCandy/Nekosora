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
