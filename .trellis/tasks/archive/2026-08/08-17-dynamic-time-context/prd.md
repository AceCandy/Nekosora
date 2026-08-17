# 动态时间上下文与搜索时间约束

## Goal

让每一轮用户请求中的主聊天、搜索词提取和联网搜索工具都基于调用当下的时间理解“今天、最近、最新”等相对表达，避免模型自行扩展为过时或宽泛的年份范围。

## Background

- 主聊天当前仅在开启联网搜索时注入 `Asia/Shanghai` 当前日期（`orchestrator.ts:376-387,557-573`）。
- 搜索词重写已动态注入当前日期，但提示允许模型“补充必要的时间信息”，仍可能生成 `2025-2026` 之类自行推断的年份（`query-rewrite.ts:28-46`）。
- `web_search` 已支持 `freshness: week|month` 和显式 `dateAfter/dateBefore`，执行时动态把 freshness 换算成日期范围（`completion-coordinator.ts:502-555`、`types.ts:80-93`）。
- Hosted Search 已动态注入日期，但当前使用 UTC 日期（`hosted-model.ts:40-54`）。
- `mem0ai@3.1.6` 当前采用 ADD-only 抽取并只做精确文本哈希去重；项目代码与规范中“去重 + 合并”的描述已失真。

## Requirements

1. 每次新的用户请求都重新读取当前时间，不将时间保存为会话状态，也不复用上一轮时间。
2. 所有主聊天均注入 `Asia/Shanghai` 的当前日期、当前时间和时区，不再以是否启用联网搜索为条件。
3. 主聊天涉及相对时间时以当轮时间为准；调用 `web_search` 时遵循：
   - “最新”优先使用 `freshness: week`；
   - “最近/近期”优先使用 `freshness: month`；
   - 用户明确表达“今天”时可用当日的 `dateAfter/dateBefore`；
   - 用户未指定历史年份或范围时，不得在查询词中自行添加往年或宽泛年份区间；
   - `freshness` 与 `dateAfter/dateBefore` 仍保持互斥。
4. 搜索词重写每次调用时动态读取 `Asia/Shanghai` 当前日期和时间，并明确禁止根据“最近/最新”自行附加年份范围。
5. Hosted Search 每次调用时动态读取 `Asia/Shanghai` 当前日期和时间；搜索后端的日期范围继续遵循现有 UTC 边界契约。
6. `web_search` 的 freshness 日期范围继续在工具执行时动态计算；不引入请求级时间快照或会话级时间字段。
7. 保持 mem0 3.1.6 的现有 ADD-only 行为，不新增项目级语义合并；仅修正文档和注释中错误的“自动合并”描述。

## Acceptance Criteria

- [x] 未开启联网搜索的普通聊天也收到当轮 `Asia/Shanghai` 日期、时间和时区。
- [x] 连续两轮请求在模拟时间变化后分别收到各自的新时间，不读取会话中的旧时间。
- [x] 搜索词重写提示包含调用当下时间，并明确禁止把“最近/最新”扩展成推断年份范围。
- [x] `web_search` 工具说明明确映射“最新→week、最近/近期→month、今天→当日范围”，且保持参数互斥校验。
- [x] Hosted Search 提示使用调用当下的 `Asia/Shanghai` 时间；显式检索范围仍标注并遵循 UTC 边界。
- [x] freshness 日期范围仍由工具执行时的当前时间动态计算。
- [x] mem0 相关代码注释与后端规范准确描述 3.1.6 的 ADD-only 与精确文本去重行为。
- [x] 相关定向单测通过；执行 `git diff --check`。

## Out of Scope

- 不实现 mem0 记忆语义合并或清理现有重复记忆。
- 不把当前时间持久化到数据库、会话、缓存或聊天消息。
- 不给标题生成、摘要、记忆抽取等与用户回答无关的内部 AI 任务统一注入时间。
- 不增加新的时区配置或第三方日期依赖。
- 不改变搜索结果排序算法、搜索供应商或模型路由。

## Risks

- 时间约束属于模型提示，不能保证所有上游模型绝对遵守；结构化 freshness/date range 可降低但不能完全消除模型生成错误。
- Hosted Search 的当前时刻展示改为 `Asia/Shanghai`，但检索范围仍保持 UTC，避免破坏供应商边界映射。
