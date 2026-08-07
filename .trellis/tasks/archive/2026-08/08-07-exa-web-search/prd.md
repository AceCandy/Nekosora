# 新增 Exa 联网搜索后端

## Goal

在不改变现有联网搜索编排方式的前提下，将 Exa 作为可配置的外部搜索 Provider，
利用其语义搜索和原生发布日期过滤补充现有搜索覆盖，并继续由用户配置的全局顺序决定回退优先级。

## Background

- 当前搜索已经支持 `current-model`、指定模型和外部 Provider 的有序回退，并记录每次尝试结果；本任务不重做编排器。
- Exa 官方 Search API 使用 `POST https://api.exa.ai/search` 和 `x-api-key` 认证，支持 `numResults`、`startPublishedDate`、`endPublishedDate` 以及可选内容提取。
- 当前 `SearchResult` 需要 `snippet` 为最终模型提供事实上下文。若 Exa 只返回元数据，通常只有标题、URL 和发布日期；因此本任务使用有界 highlights，而不是照搬 GrokSearch-rs 依赖后续 enrichment 的元数据模式。
- 搜索 Provider 配置存于现有 `user_settings.value` JSON；新增 Provider 类型不需要 PostgreSQL 或 Drizzle 迁移。

## Requirements

- 在联网搜索设置中提供 Exa 类型，允许用户配置名称、API Key、启停状态和全局搜索顺序。
- API Key 继续使用现有服务端加密存储和 DTO 脱敏规则；编辑时空 Key 保留原值。
- Exa 请求使用官方固定端点和 `x-api-key`，不新增自定义 Base URL、SDK 或依赖。
- 请求数量沿用现有 `maxResults`，并满足 Exa `numResults` 的 `1..100` 约束。
- 每次搜索请求 `contents.highlights.maxCharacters = 600`；将 `highlights[]` 按顺序合并为 `snippet`，不请求全文或 LLM summary。
- `week`、`month` 和 `custom` 均为 Exa 可强制执行的时间范围：将现有 UTC 起止日期分别映射为 `startPublishedDate` 和 `endPublishedDate`，不得降级为无时间限制搜索。
- 响应只接收经过结构校验的 `results[]`；映射 `title`、`url`、`publishedDate` 和 `highlights[]`，后续 URL 校验、去重、长度限制、缓存、重试和回退继续复用现有 service。
- AbortSignal 必须传递到 Exa HTTP 请求；非 2xx 响应使用现有 `SearchProviderError`，不得将 API Key 或原始上游响应暴露给客户端。
- 中英文设置文案同步增加 Exa；不得改变现有 Provider 的配置或顺序。

## Acceptance Criteria

- [x] 用户可以新增、编辑、启停、删除并排序 Exa 搜索后端，浏览器永远收不到明文或密文 API Key。
- [x] 普通搜索向 Exa 发送 `query`、受限 `numResults` 和最多 600 字符的 highlights 请求，并将有效结果转换为带 snippet 的现有 `SearchResult`。
- [x] `week`、`month`、`custom` 请求均发送准确的 UTC 发布日期起止边界；不支持或失败时沿现有后端顺序回退。
- [x] Exa 返回空结果、无效 URL、HTTP 错误、限流/服务端错误或被取消时，现有搜索结果规范化、重试和回退语义保持成立。
- [x] 旧 V1/V2 搜索配置仍可读取，现有四类 Provider 行为不变，且不产生数据库迁移。
- [x] Provider 请求/响应映射、日期范围、错误、取消和配置解析有自动化测试；中英文文案键保持一致。

## Out Of Scope

- Exa `/contents` 独立正文抓取、Firecrawl、TinyFish 或其他新 Provider。
- 多 Provider 并行搜索、结果融合、查询拆分或重排序。
- 域名包含/排除、搜索模式、分类等新的用户配置项。
- 修改模型目录、Hosted Search、SSE、历史投影或搜索 trace 数据结构。
