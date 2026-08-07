# Exa 联网搜索后端设计

## 目标与边界

在现有外部搜索 Provider 边界内增加 Exa，不改变 `searchWeb` 的有序回退、重试、缓存、结果规范化、SSE 或历史投影。Exa 只是新的 API-key-only Provider；所有跨 Provider 行为继续由现有 service 负责。

## 数据流

```text
联网搜索设置
  -> 现有 V2 JSON 配置与密钥加密
  -> resolveExternalSearchBackends
  -> createExaProvider(apiKey)
  -> POST https://api.exa.ai/search
  -> SearchResult[]
  -> 现有 normalize/cache/fallback
  -> 现有 tool result / SSE / trace
```

## Provider 契约

新增 `createExaProvider(apiKey): SearchProvider`，沿用 Tavily Provider 的固定端点和原生 `fetch` 模式：

- Endpoint：`https://api.exa.ai/search`。
- Headers：`Content-Type: application/json`、`x-api-key: <key>`。
- Body：
  - `query`：原查询，不拼接 `latest` 等词。
  - `numResults`：将现有 `maxResults` 夹在 `1..100`；正常 service 路径仍为 5。
  - `contents.highlights.maxCharacters`：固定 600，与现有 snippet 上限一致。
  - 有 `timeRange` 时发送 `startPublishedDate = startDate + T00:00:00.000Z` 和 `endPublishedDate = endDate + T23:59:59.999Z`。
- 不显式发送 `type`，使用 Exa 默认 `auto`；不发送全文、summary、category、domain filters 或已弃用字段。
- 显式声明全部 `SearchTimeRange` 可执行，因为三个 preset 最终都带完整 UTC 起止日期。

响应使用 Zod 在外部数据边界校验：

- 顶层 `results` 可缺省并视为空数组。
- 单项只读取可选 `title`、`url`、`publishedDate`、`highlights[]`。
- `highlights[]` 去空白后按顺序以换行连接为 `snippet`；最终 600 字符限制仍由现有 `normalizeResults` 兜底。
- URL、日期、去重和数量不在 Provider 重复实现，交给现有 service。
- 非 2xx 抛 `SearchProviderError("exa HTTP <status>", status)`；错误体和 API Key 不进入消息、日志或客户端。
- 上层 AbortSignal 直接传给 `fetch`。

## 配置与界面

- `WebSearchProviderType`、后端配置 Zod enum、Server Action 输入 enum 和设置页 `TYPES` 同步增加 `exa`。
- Exa 复用现有非 SearXNG 的 API Key 表单、密钥保留、加密存储、DTO 脱敏、启停、删除和拖拽排序逻辑。
- 增加中英文 `type_exa`、`hint_exa`，并更新 Provider 描述；不增加新输入控件。
- 不改变配置 `version: 2`，旧配置可继续读取，不做数据库迁移或回填。

## 兼容性与回滚

- 未配置 Exa 的用户行为完全不变；新增枚举只扩展合法配置值。
- Exa 失败、空结果或返回无效 URL 时，现有链路继续尝试下一个后端。
- 回滚只需删除 Exa 代码、枚举和文案；已有用户配置中的 Exa 项在旧版本会使整份配置无法通过当前严格 enum 解析，因此部署回滚前应确认没有用户已保存 Exa 配置，或先移除这些配置项。这是唯一新增的版本回滚风险。
- 当前工作树的 Markdown/link-preview 任务已修改消息文件和 web-search 公网请求文件；实现只能基于磁盘现状增量编辑，不触碰 `public-http.ts`，不得覆盖或回滚其他任务改动。

## 取舍

- 选择 highlights 而非元数据：增加少量 Exa 内容提取费用和延迟，但保证主模型获得有来源的事实片段。
- 选择 highlights 而非 summary：避免额外 LLM 摘要成本，保留更直接的来源文本。
- 不新增 Provider capability 对象、SDK、共享 HTTP 抽象或 `/contents` 阶段；现有 `supportsTimeRange` 和 `fetch` 已满足本任务。
