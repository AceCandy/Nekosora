/**
 * 联网搜索抽象层类型。
 *
 * 统一为同一份 SearchProvider 接口,供 registry 按用户配置(per-user)切换。
 * 支持的 provider 类型:tavily / bocha / zhipu / searxng。
 */

/** 单条搜索结果(各 provider 输出归一化后的最小公共集)。 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 联网搜索 provider 契约。 */
export interface SearchProvider {
  /** provider 标识(对应 WebSearchProviderConfig.type 的取值)。 */
  name: string;
  /** 执行搜索,返回归一化结果列表。失败应抛错由上层捕获降级。 */
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}

export interface SearchOptions {
  /** 期望结果数量(默认 5)。 */
  maxResults?: number;
}

/** 搜索聚合后的结构化结果(供注入 system + 前端引用卡片)。 */
export interface SearchBundle {
  results: SearchResult[];
  /** 是否命中(用于 UI 展示引用块)。 */
  hit: boolean;
  /** 失败原因(hit=false 时填写)。 */
  reason?: string;
}

/** 联网搜索 provider 类型。 */
export type WebSearchProviderType = "tavily" | "bocha" | "zhipu" | "searxng";

/**
 * 单条联网搜索 provider 配置(per-user,存 user_settings key=web_search)。
 * - tavily/bocha/zhipu 需要 apiKey;zhipu 可选 model。
 * - searxng 为自建实例,只需 baseUrl,无需 apiKey。
 */
export interface WebSearchProviderConfig {
  /** 唯一 id(uuid)。 */
  id: string;
  type: WebSearchProviderType;
  /** 用户自定义名称。 */
  name: string;
  apiKey?: string;
  /** 仅 zhipu 用(默认 glm-4-plus)。 */
  model?: string;
  /** searxng 自建实例地址。 */
  baseUrl?: string;
  enabled: boolean;
}

/** per-user 联网搜索配置(JSON 存 user_settings key=web_search)。 */
export interface WebSearchConfig {
  version: 1;
  providers: WebSearchProviderConfig[];
}
