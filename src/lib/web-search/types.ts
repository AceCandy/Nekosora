/**
 * 联网搜索抽象层类型。
 *
 * 借鉴 AQBot 的多 provider 接入思路(Tavily / 智谱 / Bocha),
 * 统一为同一份 SearchProvider 接口,供 registry 按 system_settings 切换。
 */

/** 单条搜索结果(各 provider 输出归一化后的最小公共集)。 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 联网搜索 provider 契约。 */
export interface SearchProvider {
  /** provider 标识(对应 system_settings.web_search.provider 的取值)。 */
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
