# 联网搜索结构化时效控制设计

## Boundary

本次改动沿用现有单一逻辑工具和有序后端架构，不增加配置版本或数据库列。时间条件在工具参数边界校验，转成内部判别联合后贯穿搜索服务、provider adapter、Hosted Search、缓存、工具结果和 `process_trace`。

## Contracts

### Tool input

- `query: string`：保持必填。
- `freshness?: "week" | "month"`：`week` 用于“最新/最新新闻”，`month` 用于“近期”。
- `dateAfter?: YYYY-MM-DD` 与 `dateBefore?: YYYY-MM-DD`：必须成对出现，边界均包含。
- `freshness` 与明确日期范围互斥；普通查询三者均缺省。

服务端使用 UTC 将 freshness 解析成实际起止日期。模型通过工具字段描述时间意图，服务端不做自然语言关键词匹配。

### Internal range

内部只传递一种规范化范围：`week`、`month` 或明确的 `{ after, before }`。搜索 bundle、attempt 和 trace 记录请求范围；成功结果额外记录实际范围及是否发生 7 天到 30 天回退。

### Results

`SearchResult` 增加可选 `publishedAt`。只接受上游真实返回且能解析的日期，统一成 ISO 字符串；缺失或非法时省略，不根据正文猜测。搜索上下文把日期与来源一起交给最终回答模型。

## Execution

普通查询保持当前单轮后端循环。时间查询按范围分轮：

1. `week` 请求先按用户配置顺序尝试所有支持 7 天范围的后端。
2. 第一轮没有结果时，按同一顺序执行唯一一次 `month` 回退。
3. `month` 和明确日期请求只有一轮，失败后不执行无界搜索。
4. 不支持当前范围的后端记录 `unsupported` attempt，不发起上游请求。
5. 每轮仍由首个有效结果结束，保持现有后端优先级语义。

## Provider Matrix

| Backend | week | month | explicit dates | date metadata |
| --- | --- | --- | --- | --- |
| Tavily | `time_range=week` | `time_range=month` | `start_date/end_date` | `published_date` |
| SearXNG | no | `time_range=month` | no | 无统一可靠字段 |
| Google Hosted Search | 转成 `timeRangeFilter` | 转成 `timeRangeFilter` | `timeRangeFilter` | 无统一可靠字段 |
| Bocha / 智谱 | no | no | no | 当前版本未接入 |
| OpenAI / Anthropic / xAI Hosted Search | no | no | no | 不提供可用硬过滤契约 |

能力依据是当前 provider 请求实现、官方参数和锁定的 AI SDK 4.x 类型，未知能力按不支持处理。

## Cache And Persistence

- 外部搜索缓存键在 user/backend/query 之外加入规范化范围，避免不同范围串用缓存。
- `process_trace` 是 JSONB；给 citation、call 和 attempt 增加可选字段即可兼容旧记录，不需要 PostgreSQL 迁移或 Drizzle snapshot 变更。
- SSE citation 结构沿用现有向前兼容的可选字段并保留 `publishedAt`；范围元数据保存在工具结果和 `process_trace`，历史恢复和续写不得丢失对应数据。

## Compatibility And Rollback

- 不带时间参数的旧工具调用、旧 trace 和旧缓存行为保持不变。
- 不升级依赖，不新增 provider，不修改用户配置格式。
- 回滚只需撤销 TypeScript/provider 改动；没有数据迁移或不可逆写入。

## Trade-offs

- 对不支持硬过滤的 Hosted Search 不使用 prompt 冒充时间过滤，代价是部分现有后端在时间查询中会被跳过。
- 本次不做多源聚合和结果重排；可靠时间边界优先于扩大结果数量。
- `publishedAt` 目前主要来自 Tavily；其他后端后续需在官方契约明确后逐个接入。
