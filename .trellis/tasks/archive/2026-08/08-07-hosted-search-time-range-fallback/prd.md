# 联网模型时间范围提示词降级

## Goal

当 Hosted 搜索模型支持联网、但其原生搜索工具不接受时间范围参数时，仍使用该模型搜索，并通过提示词保留用户的日期约束，避免不必要地回退到后续搜索后端。

## Background

- 当前 `buildHostedSearchRuntime` 在请求包含时间范围且搜索格式不是 `google` 时直接返回 `null`，因此 OpenAI、Anthropic 和 xAI Hosted 搜索会被记为“不支持时间范围”并跳过。
- OpenAI Responses API 的 `web_search` 支持联网搜索，但不提供任意起止日期的原生过滤参数；日期意图可以通过搜索提示词表达。
- Google Hosted 搜索与 Tavily 等外部 Provider 已有原生时间范围参数，现有严格过滤行为应保留。

## Requirements

- Hosted 搜索路由不得仅因缺少原生时间范围过滤能力而被判定为不支持。
- 对不支持原生时间范围过滤的 Hosted 搜索格式，将请求的开始日期、结束日期及时间范围含义写入搜索提示词。
- 对支持原生时间范围过滤的 Google Hosted 搜索，继续传递 `timeRangeFilter`；提示词也可保留相同日期约束，但不得削弱原生过滤。
- 外部搜索 Provider 的能力判断、时间范围参数和回退顺序保持不变。
- 真正不支持 Hosted 搜索的模型或不兼容路由仍按现有逻辑回退。
- 不新增配置项、数据库变更或前端功能。

## Acceptance Criteria

- [x] OpenAI、Anthropic 和 xAI Hosted 搜索在携带时间范围时能够构造搜索运行时，而不是返回 `null`。
- [x] 携带时间范围的 Hosted 搜索提示词明确包含开始日期和结束日期。
- [x] 不携带时间范围时，现有搜索提示词内容和 Hosted 搜索工具配置保持兼容。
- [x] Google Hosted 搜索仍向原生工具传递 `timeRangeFilter`。
- [x] 不支持搜索或协议不兼容的路由仍不可构造 Hosted 搜索运行时。
- [x] 相关定向单元测试通过。

## Out of Scope

- 不为 OpenAI、Anthropic 或 xAI 伪造其 API 未提供的原生日期过滤字段。
- 不修改搜索尝试链的前端展示或 UUID 显示问题。
- 不保证仅靠提示词获得与原生过滤完全相同的严格日期边界。

## Risks

- 提示词时间约束属于尽力而为，模型或搜索服务仍可能返回范围外来源；具备严格原生过滤能力的后端不受此风险影响。
