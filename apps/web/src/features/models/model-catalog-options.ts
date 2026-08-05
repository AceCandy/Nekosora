export interface RankableCatalogOption {
  name: string;
  canonicalModelId: string;
}

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
const family = (value: string) => value.toLocaleLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/)[0] ?? "";

/** 通用模板置顶，再按当前模型名的前缀与首字母相关度排序。 */
export function rankCatalogOptions<T extends RankableCatalogOption>(
  catalog: T[],
  modelName: string,
  query = "",
): T[] {
  const modelKey = normalize(modelName);
  const modelFamily = family(modelName);
  const queryKey = normalize(query);
  const score = (entry: T) => {
    const canonicalKey = normalize(entry.canonicalModelId);
    const nameKey = normalize(entry.name);
    if (entry.canonicalModelId.toLocaleLowerCase().startsWith("__generic_")) return 0;
    if (
      modelKey &&
      ([canonicalKey, nameKey].some((key) => key.startsWith(modelKey) || modelKey.startsWith(key)) ||
        [entry.canonicalModelId, entry.name].some((value) => family(value) === modelFamily))
    ) return 1;
    if (modelKey && [canonicalKey, nameKey].some((key) => key[0] === modelKey[0])) return 2;
    return 3;
  };

  return catalog
    .filter((entry) => !queryKey || [entry.name, entry.canonicalModelId].some((value) => normalize(value).includes(queryKey)))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
